import { FileText } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { conversationTranscriptChangedChannel } from '@shared/events/conversationEvents';
import { getTaskMenuConversation } from '@renderer/features/tasks/components/task-menu-session-info';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { FilePathActionsDropdown } from '@renderer/lib/components/file-path-actions';
import { events, rpc } from '@renderer/lib/ipc';
import { DropdownMenuItem } from '@renderer/lib/ui/dropdown-menu';
import { TranscriptLineItem } from './components/transcript-line';
import {
  normalizeConversationTranscript,
  type ConversationTranscript,
} from './transcript-normalization';

/**
 * Live mirror of the conversation's RAW on-disk JSONL (Claude session
 * transcript / Codex rollout) — every line complete and unfiltered. The main
 * process fs.watches the file and pushes change events; the panel refetches
 * the tail on every push. The full file opens in the regular file viewer.
 */
export function useConversationTranscript(active: boolean): {
  transcript: ConversationTranscript | undefined;
  hasConversation: boolean;
  openFile: () => void;
} {
  const provisionedTask = useProvisionedTask();
  const { tabManager } = provisionedTask.taskView;
  const conversation = getTaskMenuConversation(provisionedTask);
  const conversationId = conversation?.id;
  const projectId = conversation?.projectId;
  const taskId = conversation?.taskId;
  const [transcript, setTranscript] = useState<ConversationTranscript | undefined>();

  useEffect(() => {
    // Reset on conversation switch so a stale transcript never flashes.
    setTranscript(undefined); // eslint-disable-line react-hooks/set-state-in-effect
  }, [conversationId]);

  useEffect(() => {
    if (!active || !conversationId || !projectId || !taskId) return;
    let cancelled = false;
    const refetch = () =>
      rpc.conversations
        .getConversationTranscript(projectId, taskId, conversationId)
        .then((result) => {
          if (!cancelled) setTranscript(normalizeConversationTranscript(result));
        })
        .catch(() => {
          if (!cancelled) setTranscript(normalizeConversationTranscript(null));
        });
    void refetch();
    void rpc.conversations.subscribeConversationTranscript(projectId, taskId, conversationId);
    const off = events.on(
      conversationTranscriptChangedChannel,
      () => void refetch(),
      conversationId
    );
    return () => {
      cancelled = true;
      off();
      void rpc.conversations.unsubscribeConversationTranscript(projectId, taskId, conversationId);
    };
  }, [active, conversationId, projectId, taskId]);

  const openFile = () => {
    if (transcript?.filePath) tabManager.openFile(transcript.filePath);
  };

  return { transcript, hasConversation: Boolean(conversation), openFile };
}

/** Header count badge for the Transcript blind — total JSONL lines on disk. */
export const TranscriptCount = observer(function TranscriptCount({
  feed,
}: {
  feed: ReturnType<typeof useConversationTranscript>;
}) {
  if (!feed.hasConversation || feed.transcript === undefined) return null;
  return (
    <span className="px-1.5 font-mono text-[11px] text-foreground-passive">
      {feed.transcript.totalLines}
    </span>
  );
});

/** Header action: shared file-actions dropdown for the underlying JSONL. */
export const TranscriptFileActions = observer(function TranscriptFileActions({
  feed,
}: {
  feed: ReturnType<typeof useConversationTranscript>;
}) {
  const { t } = useTranslation();
  const provisioned = useProvisionedTask();
  const filePath = feed.transcript?.filePath;
  if (!filePath) return null;
  return (
    <FilePathActionsDropdown
      target={{
        absolutePath: filePath,
        sshConnectionId: provisioned.workspace.sshConnectionId ?? null,
      }}
    >
      <DropdownMenuItem
        onClick={(event) => {
          event.stopPropagation();
          feed.openFile();
        }}
      >
        <FileText className="size-4" />
        {t('fileActions.openInYoda')}
      </DropdownMenuItem>
    </FilePathActionsDropdown>
  );
});

/** Content of the Transcript blind — raw JSONL tail, pinned to bottom. */
export const TranscriptContent = observer(function TranscriptContent({
  feed,
}: {
  feed: ReturnType<typeof useConversationTranscript>;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef(true);
  const transcript = feed.transcript;

  // Follow the file like `tail -f`: stay pinned to the bottom while the user
  // hasn't scrolled up; a manual scroll up unpins until they return.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pinnedToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [transcript]);

  if (!feed.hasConversation) {
    return (
      <div className="px-3 py-3 text-xs text-foreground-passive">
        {t('tasks.transcript.noSession')}
      </div>
    );
  }
  if (transcript === undefined) {
    return (
      <div className="px-3 py-3 text-xs text-foreground-passive">
        {t('tasks.transcript.loading')}
      </div>
    );
  }
  if (transcript.lines.length === 0) {
    return (
      <div className="px-3 py-3 text-xs text-foreground-passive">{t('tasks.transcript.empty')}</div>
    );
  }

  const hiddenLines = transcript.totalLines - transcript.lines.length;

  return (
    <div
      ref={scrollRef}
      className="max-h-96 overflow-y-auto"
      onScroll={(event) => {
        const el = event.currentTarget;
        pinnedToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      {hiddenLines > 0 ? (
        <button
          type="button"
          className="block w-full cursor-pointer border-b border-border/40 px-3 py-1.5 text-left text-[11px] text-foreground-passive hover:bg-background-2 hover:text-foreground"
          onClick={feed.openFile}
        >
          {t('tasks.transcript.earlierLines', { count: hiddenLines })}
        </button>
      ) : null}
      {transcript.lines.map((line, index) => {
        const lineNo = transcript.totalLines - transcript.lines.length + index + 1;
        return <TranscriptLineItem key={`${lineNo}:${line.length}`} line={line} lineNo={lineNo} />;
      })}
    </div>
  );
});
