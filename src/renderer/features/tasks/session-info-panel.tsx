import { Loader2, Maximize2, MoreHorizontal, SlidersHorizontal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ClaudeSessionPrompt,
  Conversation,
  SessionSummary,
  SessionSummaryResult,
  SessionSummaryStatus,
} from '@shared/conversations';
import {
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import {
  buildTaskMenuSessionFields,
  getTaskMenuConversation,
  resolveTaskMenuSessionFields,
  type TaskMenuSessionFields,
} from '@renderer/features/tasks/components/task-menu-session-info';
import { displaySessionPromptText } from '@renderer/features/tasks/context-panel-prompt-display';
import { RenamePanel } from '@renderer/features/tasks/rename-panel';
import { buildPromptPreviewItems } from '@renderer/features/tasks/session-prompts-preview';
import { getTaskStore, taskDisplayName } from '@renderer/features/tasks/stores/task-selectors';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { MicroLabel } from '@renderer/lib/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';

export const SessionInfoPanel = observer(function SessionInfoPanel({
  active,
  chromeless = false,
}: {
  active: boolean;
  chromeless?: boolean;
}) {
  const { t } = useTranslation();
  const { projectId, taskId } = useTaskViewContext();
  const provisionedTask = useProvisionedTask();
  const taskStore = getTaskStore(projectId, taskId);
  const conversation = getTaskMenuConversation(provisionedTask);
  // Observe the live PTY session status so the panel re-fetches session info
  // (e.g. tmux enabled/disabled) whenever the session restarts — from this
  // panel's button or from a context-menu "restart with/without tmux".
  const sessionStatus = conversation
    ? provisionedTask.conversations.conversations.get(conversation.id)?.session.status
    : undefined;
  const [isLoading, setIsLoading] = useState(false);
  const [resolvedFields, setResolvedFields] = useState<TaskMenuSessionFields | undefined>();

  const fallbackFields = useMemo(
    () =>
      conversation ? buildTaskMenuSessionFields(conversation, provisionedTask.path) : undefined,
    [conversation, provisionedTask.path]
  );
  const fields = fallbackFields || resolvedFields ? { ...fallbackFields, ...resolvedFields } : null;
  const projectName = projectDisplayName(getProjectStore(projectId));
  const taskName = taskDisplayName(taskStore);
  const branchName = provisionedTask.workspace.git.branchName;

  useEffect(() => {
    setResolvedFields(undefined);
  }, [conversation?.id]);

  useEffect(() => {
    if (!active || !conversation) return;
    let cancelled = false;
    setIsLoading(true);
    void resolveTaskMenuSessionFields(conversation, provisionedTask.path)
      .then((info) => {
        if (!cancelled) setResolvedFields(info);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, conversation, provisionedTask.path, sessionStatus]);

  const runningStatus =
    fields?.running === undefined
      ? t('tasks.sessionInfo.unknown')
      : fields.running
        ? t('tasks.sessionInfo.running')
        : t('tasks.sessionInfo.notRunning');
  const tmuxStatus =
    fields?.running === false
      ? t('tasks.sessionInfo.notRunning')
      : fields?.tmuxEnabled === undefined
        ? t('tasks.sessionInfo.unknown')
        : fields.tmuxEnabled
          ? t('tasks.sessionInfo.enabled')
          : t('tasks.sessionInfo.disabled');

  return (
    <div
      className={cn(
        'flex w-full flex-col overflow-hidden',
        chromeless ? 'min-h-0' : 'h-full bg-background'
      )}
    >
      {chromeless ? null : (
        <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-border/70 pl-3 pr-1.5">
          <MicroLabel className="truncate text-foreground-passive">
            {t('tasks.sessionInfo.title')}
          </MicroLabel>
          {isLoading ? <Loader2 className="size-3.5 animate-spin text-foreground-passive" /> : null}
        </div>
      )}

      <div className={cn('px-2.5 py-2', chromeless ? 'min-w-0' : 'min-h-0 flex-1 overflow-y-auto')}>
        {!conversation || !fields ? (
          <EmptyState
            label={t('tasks.sessionInfo.noSession')}
            description={t('tasks.sessionInfo.noSessionDescription')}
          />
        ) : (
          <div className="flex min-w-0 flex-col gap-2">
            {/*
             * Two-column key/value grid. The label column is sized to its
             * widest label (`auto`) and shared by every row via subgrid, so it
             * never reserves more width than the longest label needs.
             */}
            <section className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 rounded-md border border-border bg-background-1/40 px-2 py-1.5">
              <SessionInfoValue
                label={t('tasks.context.taskInfo.task')}
                value={taskName}
                action={<TaskNamingDebugPopover />}
              />
              <SessionInfoValue label={t('tasks.context.taskInfo.project')} value={projectName} />
              <SessionInfoValue
                label={t('tasks.context.taskInfo.branch')}
                value={branchName ?? undefined}
                mono
              />
              <SessionInfoDivider />
              <SessionInfoValue
                label={t('tasks.context.taskInfo.provider')}
                value={fields.providerName}
              />
              <SessionInfoValue
                label={t('tasks.context.taskInfo.sessionId')}
                value={fields.sessionId}
                mono
              />
              <SessionInfoValue label={t('tasks.sessionInfo.status')} value={runningStatus} />
              <SessionInfoValue label={t('tasks.sessionInfo.tmux')} value={tmuxStatus} />
              <SessionInfoValue
                label={t('tasks.sessionInfo.resumeCommand')}
                value={fields.resumeCommand}
                mono
              />
            </section>
          </div>
        )}
      </div>
    </div>
  );
});

/**
 * Loads and exposes the active conversation's prompt history. Drives both the
 * 对话 blind's header action (view-all button) and its content preview, so the
 * prompts are fetched once and shared between the two.
 */
export function useSessionPrompts(active: boolean): {
  prompts: ClaudeSessionPrompt[];
  isLoading: boolean;
  hasPrompts: boolean;
  hasConversation: boolean;
  openPromptsModal: () => void;
} {
  const provisionedTask = useProvisionedTask();
  const conversation = getTaskMenuConversation(provisionedTask);
  const sessionStatus = conversation
    ? provisionedTask.conversations.conversations.get(conversation.id)?.session.status
    : undefined;
  const [prompts, setPrompts] = useState<ClaudeSessionPrompt[] | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const showSessionPrompts = useShowModal('sessionPromptsModal');

  useEffect(() => {
    // Reset on conversation switch so a stale preview never flashes.
    setPrompts(undefined); // eslint-disable-line react-hooks/set-state-in-effect
  }, [conversation?.id]);

  useEffect(() => {
    if (!active || !conversation) return;
    let cancelled = false;
    setIsLoading(true); // eslint-disable-line react-hooks/set-state-in-effect
    void resolveSessionPrompts(conversation, provisionedTask.path)
      .then((next) => {
        if (!cancelled) setPrompts(next);
      })
      .catch(() => {
        if (!cancelled) setPrompts([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, conversation, provisionedTask.path, sessionStatus]);

  const openPromptsModal = () => {
    if (!conversation) return;
    showSessionPrompts({
      prompts: prompts ?? [],
      sessionTitle: conversation.title,
    });
  };

  return {
    prompts: prompts ?? [],
    isLoading: isLoading && prompts === undefined,
    hasPrompts: (prompts?.length ?? 0) > 0,
    hasConversation: Boolean(conversation),
    openPromptsModal,
  };
}

/** Header action for the 对话 blind: opens the full prompt history modal. */
export const SessionPromptsViewAllButton = observer(function SessionPromptsViewAllButton({
  prompts,
}: {
  prompts: ReturnType<typeof useSessionPrompts>;
}) {
  const { t } = useTranslation();
  if (!prompts.hasPrompts) return null;
  return (
    <button
      type="button"
      className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
      onClick={(e) => {
        // The button lives in the accordion header; stop the click from also
        // toggling the blind open/closed.
        e.stopPropagation();
        prompts.openPromptsModal();
      }}
    >
      <Maximize2 className="size-3" />
      {t('tasks.sessionInfo.viewAllPrompts')}
    </button>
  );
});

/** Content of the 对话 blind — the prompt history preview. */
export const SessionPromptsContent = observer(function SessionPromptsContent({
  prompts,
}: {
  prompts: ReturnType<typeof useSessionPrompts>;
}) {
  const { t } = useTranslation();

  if (!prompts.hasConversation) {
    return (
      <div className="px-2.5 py-3">
        <EmptyState
          label={t('tasks.sessionInfo.noSession')}
          description={t('tasks.sessionInfo.noSessionDescription')}
        />
      </div>
    );
  }

  return (
    <div className="min-w-0 px-2.5 py-2">
      <SessionPromptsPreview
        prompts={prompts.prompts}
        isLoading={prompts.isLoading}
        onOpenAll={prompts.openPromptsModal}
      />
    </div>
  );
});

/**
 * Loads a session summary for the active conversation: the runtime's own
 * compaction summary when one exists, otherwise an on-demand summary generated
 * from the conversation. Refreshes whenever the session goes idle (i.e. after
 * each reply) while the panel is open.
 */
export function useSessionSummary(active: boolean): {
  summary: SessionSummary | null;
  status: SessionSummaryStatus | undefined;
  isLoading: boolean;
  hasConversation: boolean;
} {
  const { projectId, taskId } = useTaskViewContext();
  const provisionedTask = useProvisionedTask();
  const conversation = getTaskMenuConversation(provisionedTask);
  // Observing the live session status re-runs the resolve when the agent
  // transitions to idle/completed — i.e. after each reply, while open.
  const sessionStatus = conversation
    ? provisionedTask.conversations.conversations.get(conversation.id)?.session.status
    : undefined;
  const [result, setResult] = useState<SessionSummaryResult | undefined>();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setResult(undefined); // eslint-disable-line react-hooks/set-state-in-effect
  }, [conversation?.id]);

  useEffect(() => {
    if (!active || !conversation) return;
    let cancelled = false;
    setIsLoading(true); // eslint-disable-line react-hooks/set-state-in-effect
    void resolveSessionSummary(conversation, projectId, taskId, provisionedTask.path)
      .then((next) => {
        if (!cancelled) setResult(next);
      })
      .catch(() => {
        if (!cancelled) setResult({ summary: null, status: 'failed' });
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, conversation, projectId, taskId, provisionedTask.path, sessionStatus]);

  return {
    summary: result?.summary ?? null,
    status: result?.status,
    // Keep the spinner up across re-generation, not just the first load — an
    // on-demand summary can take seconds and there is no stale text to show.
    isLoading: isLoading && !result?.summary,
    hasConversation: Boolean(conversation),
  };
}

/** Maps a no-summary outcome to the empty-state copy explaining it. */
function emptySummaryCopy(status: SessionSummaryStatus | undefined): {
  label: string;
  description: string;
} {
  switch (status) {
    case 'running':
      return {
        label: 'tasks.sessionPanel.summaryRunning',
        description: 'tasks.sessionPanel.summaryRunningDescription',
      };
    case 'failed':
      return {
        label: 'tasks.sessionPanel.summaryFailed',
        description: 'tasks.sessionPanel.summaryFailedDescription',
      };
    default:
      return {
        label: 'tasks.sessionPanel.summaryEmpty',
        description: 'tasks.sessionPanel.summaryEmptyDescription',
      };
  }
}

/** Content of the 摘要 blind — the session summary (compaction or generated). */
export const SessionSummaryContent = observer(function SessionSummaryContent({
  summary,
}: {
  summary: ReturnType<typeof useSessionSummary>;
}) {
  const { t } = useTranslation();

  if (!summary.hasConversation) {
    return (
      <div className="px-2.5 py-3">
        <EmptyState
          label={t('tasks.sessionInfo.noSession')}
          description={t('tasks.sessionInfo.noSessionDescription')}
        />
      </div>
    );
  }

  if (summary.isLoading) {
    return (
      <div className="flex items-center gap-1.5 px-3.5 py-3 text-xs text-foreground-passive">
        <Loader2 className="size-3 animate-spin" />
        {t('tasks.sessionPanel.summaryGenerating')}
      </div>
    );
  }

  if (!summary.summary) {
    const empty = emptySummaryCopy(summary.status);
    return (
      <div className="px-2.5 py-3">
        <EmptyState label={t(empty.label)} description={t(empty.description)} />
      </div>
    );
  }

  const timestamp = summary.summary.timestamp
    ? new Date(summary.summary.timestamp).toLocaleString()
    : null;

  return (
    <div className="flex min-w-0 flex-col gap-1.5 px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-[10px] text-foreground-passive">
          {summary.status === 'generated'
            ? t('tasks.sessionPanel.summaryGenerated')
            : t('tasks.sessionPanel.summaryFromCompaction')}
        </span>
        {timestamp ? (
          <span className="ml-auto shrink-0 font-mono text-[10px] text-foreground-passive">
            {timestamp}
          </span>
        ) : null}
      </div>
      <div className="max-h-[60vh] min-w-0 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background-1/40 px-2.5 py-2 text-[11px] leading-relaxed text-foreground-muted">
        {summary.summary.text}
      </div>
    </div>
  );
});

async function resolveSessionSummary(
  conversation: Conversation,
  projectId: string,
  taskId: string,
  cwd: string
): Promise<SessionSummaryResult> {
  try {
    return await rpc.conversations.getSessionSummary(
      conversation.providerId,
      projectId,
      taskId,
      cwd,
      conversation.id,
      conversation.title,
      conversation.createdAt ?? null
    );
  } catch {
    return { summary: null, status: 'failed' };
  }
}

async function resolveSessionPrompts(
  conversation: Conversation,
  cwd: string,
  sessionId?: string
): Promise<ClaudeSessionPrompt[]> {
  try {
    if (conversation.providerId === 'claude') {
      const context = await rpc.conversations.getClaudeSessionContext(
        cwd,
        sessionId || conversation.id
      );
      return context?.prompts ?? [];
    }

    if (conversation.providerId === 'codex') {
      const context = await rpc.conversations.getCodexSessionContext(
        cwd,
        conversation.id,
        conversation.title,
        conversation.createdAt ?? null
      );
      return context?.prompts ?? [];
    }
  } catch {
    return [];
  }

  return [];
}

function SessionPromptsPreview({
  prompts,
  isLoading,
  onOpenAll,
}: {
  prompts: ClaudeSessionPrompt[];
  isLoading: boolean;
  onOpenAll: () => void;
}) {
  const { t } = useTranslation();
  const previewItems = useMemo(() => buildPromptPreviewItems(prompts), [prompts]);
  const hasPrompts = prompts.length > 0;

  return (
    <div className="grid gap-1">
      {isLoading ? (
        <div className="flex items-center gap-1.5 px-1 py-1.5 text-xs text-foreground-passive">
          <Loader2 className="size-3 animate-spin" />
          {t('common.loading')}
        </div>
      ) : !hasPrompts ? (
        <div className="px-1 py-1.5 text-xs text-foreground-passive">
          {t('tasks.panel.noPrompts')}
        </div>
      ) : (
        <div className="grid gap-1">
          {previewItems.map((item, index) =>
            item.type === 'truncated' ? (
              <button
                key="truncated"
                type="button"
                className="flex min-w-0 items-center justify-center gap-1.5 rounded-sm px-2 py-1 text-[11px] text-foreground-passive hover:bg-background-1 hover:text-foreground-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={onOpenAll}
              >
                <MoreHorizontal className="size-3.5" />
                {t('tasks.sessionInfo.truncatedPrompts', { count: item.hiddenCount })}
              </button>
            ) : (
              <PromptPreviewRow
                key={item.prompt.id || `${item.promptIndex}-${index}`}
                prompt={item.prompt}
                promptIndex={item.promptIndex}
                onClick={onOpenAll}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

function PromptPreviewRow({
  prompt,
  promptIndex,
  onClick,
}: {
  prompt: ClaudeSessionPrompt;
  promptIndex: number;
  onClick: () => void;
}) {
  const displayText = displaySessionPromptText(prompt.text);
  const timestamp = prompt.timestamp ? new Date(prompt.timestamp).toLocaleTimeString() : null;
  return (
    <button
      type="button"
      className="group relative grid min-w-0 grid-cols-[1.1rem_minmax(0,1fr)] gap-1.5 rounded-sm py-1 pr-1.5 text-left hover:bg-background-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      onClick={onClick}
      title={displayText}
    >
      <span className="shrink-0 pt-0.5 text-right font-mono text-[10px] text-foreground-passive">
        #{promptIndex}
      </span>
      <span className="max-h-32 min-w-0 overflow-hidden whitespace-pre-wrap break-words text-[11px] leading-snug text-foreground-muted">
        {displayText}
      </span>
      {timestamp ? (
        <span className="pointer-events-none absolute top-1 right-1.5 rounded-sm border border-border bg-background px-1 font-mono text-[10px] text-foreground-passive opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          {timestamp}
        </span>
      ) : null}
    </button>
  );
}

function SessionInfoValue({
  label,
  value,
  mono = false,
  action,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  action?: React.ReactNode;
}) {
  if (!value) return null;
  return (
    <div className="col-span-2 grid min-w-0 grid-cols-subgrid items-center gap-x-2 text-[11px] leading-tight">
      <span className="truncate text-foreground-passive" title={label}>
        {label}
      </span>
      <span className="flex min-w-0 items-center gap-1">
        <span
          className={cn('min-w-0 truncate text-foreground-muted', mono && 'font-mono')}
          title={value}
        >
          {value}
        </span>
        {action ? <span className="ml-auto shrink-0">{action}</span> : null}
      </span>
    </div>
  );
}

function SessionInfoDivider() {
  return <div className="col-span-2 my-0.5 h-px bg-border/70" />;
}

/**
 * Inline naming/debug control on the task-name row. Opens the full naming
 * panel (status, model, generated names, regenerate, context sources, debug
 * trace) in a popover instead of a dedicated blind.
 */
function TaskNamingDebugPopover() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex size-4 shrink-0 items-center justify-center rounded-sm text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
            aria-label={t('tasks.rename.panelTitle')}
            title={t('tasks.rename.panelTitle')}
          >
            <SlidersHorizontal className="size-3" />
          </button>
        }
      />
      <PopoverContent
        align="start"
        side="bottom"
        className="max-h-[70vh] w-80 gap-0 overflow-y-auto p-0"
      >
        <RenamePanel active={open} chromeless />
      </PopoverContent>
    </Popover>
  );
}
