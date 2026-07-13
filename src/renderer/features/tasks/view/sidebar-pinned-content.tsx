import { useQuery } from '@tanstack/react-query';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef } from 'react';
import { RoomMemberDetail } from '@renderer/features/agent-room/room-member-detail';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { FileActionsOverlay } from '@renderer/features/tasks/components/file-actions';
import type { ConversationStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { getResumeInitialSize } from '@renderer/features/tasks/conversations/conversations-panel';
import { FileDiffView } from '@renderer/features/tasks/diff-view/main-panel/file-diff-view';
import { OtherFileRenderer } from '@renderer/features/tasks/editor/editor-main-panel';
import { LeasedMonacoEditor } from '@renderer/features/tasks/editor/leased-monaco-editor';
import { MarkdownSourceToggleOverlay } from '@renderer/features/tasks/editor/markdown-editor-panel';
import { useIsActiveTask } from '@renderer/features/tasks/hooks/use-is-active-task';
import { getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import type { FileTabStore } from '@renderer/features/tasks/tabs/file-tab-store';
import type { TabEntry } from '@renderer/features/tasks/tabs/tab-manager-store';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { useWorkspaceWebLinks } from '@renderer/features/tasks/terminals/use-workspace-web-links';
import { buildFilePathDefaultOpenRequest } from '@renderer/lib/components/file-path-open';
import { MarkdownEditorRenderer } from '@renderer/lib/editor/markdown-renderer';
import { rpc } from '@renderer/lib/ipc';
import { PaneSizingProvider } from '@renderer/lib/pty/pane-sizing-context';
import { PtyPane } from '@renderer/lib/pty/pty-pane';
import type { TerminalFileLinkOptions } from '@renderer/lib/pty/terminal-file-links';
import { OverviewPanel } from './overview-panel';

/**
 * Renders the content of a pinned tab (conversation PTY, file editor, diff,
 * or the task overview), filling its host pane — the task sidebar strip or
 * the shell-level side pane.
 */
export const SidebarPinnedContent = observer(function SidebarPinnedContent({
  entry,
}: {
  entry: TabEntry;
}) {
  const { conversations } = useProvisionedTask();

  if (entry.kind === 'overview') {
    return (
      <div key={entry.tabId} className="h-full overflow-y-auto">
        <OverviewPanel />
      </div>
    );
  }

  if (entry.kind === 'conversation') {
    const conversation = conversations.conversations.get(entry.conversationId);
    if (!conversation) return null;
    return <SidebarPinnedConversation key={entry.tabId} conversation={conversation} />;
  }

  if (entry.kind === 'diff') {
    return (
      <FileDiffView
        key={entry.tabId}
        file={{
          path: entry.path,
          type: entry.diffGroup === 'disk' ? 'disk' : 'git',
          group: entry.diffGroup,
          originalRef: entry.originalRef,
          modifiedRef: entry.modifiedRef,
          prNumber: entry.prNumber,
        }}
      />
    );
  }

  if (entry.kind === 'file') {
    return <SidebarPinnedFile key={entry.tabId} file={entry} />;
  }

  if (entry.kind === 'room-member') {
    return <RoomMemberDetail key={entry.tabId} memberId={entry.memberId} />;
  }

  return null;
});

const SidebarPinnedFile = observer(function SidebarPinnedFile({ file }: { file: FileTabStore }) {
  switch (file.renderer.kind) {
    case 'text':
    case 'svg-source':
      return (
        <LeasedMonacoEditor
          filePath={file.path}
          revealSource={file}
          focusReveal={false}
          overlay={<FileActionsOverlay filePath={file.path} />}
        />
      );
    case 'markdown':
      return <MarkdownEditorRenderer filePath={file.path} />;
    case 'markdown-source':
      return (
        <LeasedMonacoEditor
          filePath={file.path}
          revealSource={file}
          focusReveal={false}
          overlay={<MarkdownSourceToggleOverlay filePath={file.path} />}
        />
      );
    default:
      return (
        <div className="h-full overflow-hidden">
          <OtherFileRenderer file={file} />
        </div>
      );
  }
});

const SidebarPinnedConversation = observer(function SidebarPinnedConversation({
  conversation,
}: {
  conversation: ConversationStore;
}) {
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const { conversations } = provisioned;
  const isActive = useIsActiveTask(taskId);
  const mountedProject = asMounted(getProjectStore(projectId));
  const projectRoot = mountedProject?.data.path;
  const remoteConnectionId =
    mountedProject?.data.type === 'ssh' ? mountedProject.data.connectionId : undefined;

  const session = conversation.session;
  const sessionId = session.sessionId;
  const sessionStatus = session.status;
  const sessionIds = useMemo(() => (sessionId ? [sessionId] : []), [sessionId]);

  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const lastAutoResumeSessionRef = useRef<string | null>(null);

  // Auto-resume the session when it becomes visible here (mirrors ConversationsPanel).
  useEffect(() => {
    if (!isActive) {
      lastAutoResumeSessionRef.current = null;
      return;
    }
    if (!sessionId || sessionStatus !== 'ready' || !session.pty) return;
    if (lastAutoResumeSessionRef.current === sessionId) return;
    lastAutoResumeSessionRef.current = sessionId;
    const initialSize = getResumeInitialSize(session.pty, terminalContainerRef.current);
    void conversations.resumeConversation(conversation.data.id, initialSize);
  }, [conversation, conversations, isActive, session, sessionId, sessionStatus]);

  const markConversationSubmitted = (forceWorking = false) => {
    conversation.setWorking({ force: forceWorking });
    void conversations.touchConversation(conversation.data.id);
    void getTaskStore(projectId, taskId)?.setNeedsReview(false);
  };

  const { data: homeDir } = useQuery({
    queryKey: ['homeDir'],
    queryFn: () => rpc.app.getHomeDir(),
    staleTime: Infinity,
    enabled: !remoteConnectionId,
  });
  const fileLinks = useMemo<TerminalFileLinkOptions>(
    () => ({
      workspaceRoot: provisioned.path,
      workspaceRootAliases: projectRoot ? [projectRoot] : undefined,
      homeDir: typeof homeDir === 'string' ? homeDir : undefined,
      sshConnectionId: remoteConnectionId,
      onOpen: ({ filePath, absolutePath, line, column }) => {
        if (filePath) {
          // Open into the MAIN area — the whole point of pinning is keeping
          // this session visible while inspecting other content.
          provisioned.taskView.tabManager.openFile(filePath, { line, column });
          provisioned.taskView.setFocusedRegion('main');
          return;
        }
        if (absolutePath) {
          void rpc.app.openIn(
            buildFilePathDefaultOpenRequest({
              absolutePath,
              sshConnectionId: remoteConnectionId,
              line,
              column,
            })
          );
        }
      },
    }),
    [provisioned.path, provisioned.taskView, projectRoot, remoteConnectionId, homeDir]
  );
  // URLs open as a sibling sidebar browser pin — switching chips is cheap.
  const webLinks = useWorkspaceWebLinks();

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden bg-[var(--xterm-bg)] px-2 pt-2">
      <PaneSizingProvider paneId={`sidebar-pin:${conversation.data.id}`} sessionIds={sessionIds}>
        {sessionId && sessionStatus === 'ready' && session.pty ? (
          <div
            ref={terminalContainerRef}
            className="relative flex h-full min-h-0 min-w-0 w-full flex-1 overflow-hidden"
          >
            <PtyPane
              sessionId={sessionId}
              pty={session.pty}
              className="h-full w-full min-w-0"
              onEnterPress={() => {
                markConversationSubmitted(conversation.status === 'awaiting-input');
              }}
              onSubmittedInput={(_message, isTaskInput) => {
                if (isTaskInput || conversation.status !== 'awaiting-input') return;
                markConversationSubmitted(true);
              }}
              onInterruptPress={() => conversation.clearWorking()}
              mapShiftEnterToCtrlJ
              remoteConnectionId={remoteConnectionId}
              fileLinks={fileLinks}
              webLinks={webLinks}
            />
          </div>
        ) : null}
      </PaneSizingProvider>
    </div>
  );
});
