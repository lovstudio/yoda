import {
  Loader2,
  Maximize2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ClaudeSessionPrompt,
  Conversation,
  ConversationNamingSnapshot,
  SessionSummary,
  SessionSummaryResult,
  SessionSummaryScope,
  SessionSummaryStatus,
} from '@shared/conversations';
import { conversationNamingUpdatedChannel } from '@shared/events/conversationEvents';
import {
  sessionSummaryStreamChannel,
  sessionSummaryTopic,
} from '@shared/events/sessionSummaryEvents';
import {
  getNamingDebugContextStats,
  getNamingDebugDurationEstimate,
  NamingDebugContent,
} from '@renderer/features/tasks/components/naming-debug-ui';
import {
  buildNamingContextSection,
  buildNamingSummaryItems,
  buildNamingTextSections,
  NamingPanel,
  NamingPanelConfiguration,
} from '@renderer/features/tasks/components/naming-panel-shared';
import { SummaryConfigFields } from '@renderer/features/tasks/components/summary-config-fields';
import {
  buildTaskMenuSessionFields,
  getTaskMenuConversation,
  resolveTaskMenuSessionFields,
  type TaskMenuSessionFields,
} from '@renderer/features/tasks/components/task-menu-session-info';
import { displaySessionPromptText } from '@renderer/features/tasks/context-panel-prompt-display';
import { buildPromptPreviewItems } from '@renderer/features/tasks/session-prompts-preview';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { toast } from '@renderer/lib/hooks/use-toast';
import { events, rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { MicroLabel } from '@renderer/lib/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { cn } from '@renderer/utils/utils';

/** Poll interval for the live prompt count in the 对话 blind header. */
const PROMPTS_REFRESH_MS = 3_000;

export const SessionInfoPanel = observer(function SessionInfoPanel({
  active,
  chromeless = false,
}: {
  active: boolean;
  chromeless?: boolean;
}) {
  const { t } = useTranslation();
  const provisionedTask = useProvisionedTask();
  const conversation = getTaskMenuConversation(provisionedTask);
  // Observe the live PTY session status so the panel re-fetches session info
  // (e.g. tmux enabled/disabled) whenever the session restarts — from this
  // panel's button or from a context-menu "restart with/without tmux".
  const sessionStatus = conversation
    ? provisionedTask.conversations.conversations.get(conversation.id)?.session.status
    : undefined;
  const [isLoading, setIsLoading] = useState(false);
  const [resolvedFields, setResolvedFields] = useState<TaskMenuSessionFields | undefined>();

  const fallbackFields = conversation
    ? buildTaskMenuSessionFields(conversation, provisionedTask.path)
    : undefined;
  const fields = fallbackFields || resolvedFields ? { ...fallbackFields, ...resolvedFields } : null;
  const hasSessionTimestamps = Boolean(
    conversation?.createdAt ||
      conversation?.updatedAt ||
      conversation?.lastInteractedAt ||
      conversation?.archivedAt
  );

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
            <section className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 rounded-md bg-background-1/40 px-2 py-1.5">
              <SessionTitleInfoValue
                label={t('tasks.sessionInfo.sessionTitle')}
                value={conversation.title}
                conversation={conversation}
              />
              <SessionInfoValue
                label={t('tasks.context.taskInfo.provider')}
                value={fields.runtimeName}
              />
              <SessionInfoValue
                label={t('tasks.context.taskInfo.sessionId')}
                value={fields.sessionId}
                mono
              />
              <SessionInfoValue label={t('tasks.sessionInfo.status')} value={runningStatus} />
              <SessionInfoValue label={t('tasks.sessionInfo.tmux')} value={tmuxStatus} />
              {hasSessionTimestamps ? (
                <>
                  <SessionInfoDivider />
                  <SessionInfoTimeValue
                    label={t('tasks.sessionInfo.createdAt')}
                    value={conversation.createdAt}
                  />
                  <SessionInfoTimeValue
                    label={t('tasks.sessionInfo.updatedAt')}
                    value={conversation.updatedAt}
                  />
                  <SessionInfoTimeValue
                    label={t('tasks.sessionInfo.lastInteractedAt')}
                    value={conversation.lastInteractedAt}
                  />
                  <SessionInfoTimeValue
                    label={t('tasks.sessionInfo.archivedAt')}
                    value={conversation.archivedAt}
                  />
                  <SessionInfoDivider />
                </>
              ) : null}
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
    const load = () =>
      resolveSessionPrompts(conversation, provisionedTask.path)
        .then((next) => {
          if (!cancelled) setPrompts(next);
        })
        .catch(() => {
          if (!cancelled) setPrompts([]);
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    void load();
    // Poll while open so the header count stays live as prompts stream in
    // mid-reply, not just on each session-status transition.
    const interval = setInterval(() => void load(), PROMPTS_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
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

/** Header badge for the 对话 blind: live count of prompts in the session. */
export const SessionPromptsCount = observer(function SessionPromptsCount({
  prompts,
}: {
  prompts: ReturnType<typeof useSessionPrompts>;
}) {
  if (!prompts.hasConversation) return null;
  return (
    <span className="px-1.5 font-mono text-[11px] text-foreground-passive">
      {prompts.prompts.length}
    </span>
  );
});

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
 * Loads one summary scope for the active conversation. `global` prefers the
 * runtime's compaction summary; `recent` is a short summary of the last few
 * messages. Only fetches while `active` (the section is open), and re-runs
 * whenever the session goes idle — i.e. after each reply, while open.
 */
export function useSessionSummary(
  active: boolean,
  scope: SessionSummaryScope,
  options?: {
    /**
     * Auto-generate on open and after each idle turn. `recent` is true (cheap
     * one-line note refreshed every reply); `global` is false so the
     * whole-session summary is trigger-only — no request fires until the user
     * clicks regenerate.
     */
    autoGenerate?: boolean;
  }
): {
  summary: SessionSummary | null;
  status: SessionSummaryStatus | undefined;
  /** Live partial text while a summary is streaming in (SSE), else empty. */
  streamingText: string;
  /** A summary is being (re)generated. The last summary stays visible meanwhile. */
  isGenerating: boolean;
  hasConversation: boolean;
  /** Manually run generation for this scope, bypassing the content cache. */
  regenerate: () => void;
} {
  const autoGenerate = options?.autoGenerate ?? true;
  const { projectId, taskId } = useTaskViewContext();
  const provisionedTask = useProvisionedTask();
  const conversation = getTaskMenuConversation(provisionedTask);
  // Observing the live session status re-runs the resolve when the agent
  // transitions to idle/completed — i.e. after each reply, while open.
  const sessionStatus = conversation
    ? provisionedTask.conversations.conversations.get(conversation.id)?.session.status
    : undefined;
  const [result, setResult] = useState<SessionSummaryResult | undefined>();
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  // Bumped by regenerate(); odd value (non-zero) also flags a forced run.
  const [forceNonce, setForceNonce] = useState(0);

  // Only wipe the persisted summary when the conversation itself changes; a
  // status change must NOT blank the panel — the last summary stays until the
  // next one is ready.
  useEffect(() => {
    setResult(undefined); // eslint-disable-line react-hooks/set-state-in-effect
    setStreamingText('');
    setForceNonce(0);
  }, [conversation?.id]);

  // SSE: append streamed deltas while a generation for this scope is in flight.
  useEffect(() => {
    if (!active || !conversation) return;
    const topic = sessionSummaryTopic(conversation.id, scope);
    return events.on(
      sessionSummaryStreamChannel,
      (event) => {
        if (event.scope !== scope) return;
        if (event.done) {
          setStreamingText('');
          return;
        }
        if (event.delta) setStreamingText((prev) => prev + event.delta);
      },
      topic
    );
  }, [active, conversation, scope]);

  useEffect(() => {
    if (!active || !conversation) return;
    const force = forceNonce > 0;
    // Trigger-only scopes (global) fire nothing until the user clicks
    // regenerate — opening the blind must not spawn a summarization CLI.
    if (!autoGenerate && !force) return;
    let cancelled = false;
    setIsGenerating(true); // eslint-disable-line react-hooks/set-state-in-effect
    setStreamingText('');
    // Functional updates so we never read a stale `result` from the closure:
    // replace on a real summary, otherwise keep whatever is already shown.
    void resolveSessionSummary(conversation, scope, projectId, taskId, provisionedTask.path, force)
      .then((next) => {
        if (cancelled) return;
        setResult((prev) => (next.summary || !prev ? next : prev));
      })
      .catch(() => {
        if (cancelled) return;
        setResult((prev) => prev ?? { summary: null, status: 'failed' });
      })
      .finally(() => {
        if (!cancelled) setIsGenerating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    active,
    conversation,
    scope,
    projectId,
    taskId,
    provisionedTask.path,
    sessionStatus,
    forceNonce,
    autoGenerate,
  ]);

  const regenerate = useCallback(() => setForceNonce((n) => n + 1), []);

  return {
    summary: result?.summary ?? null,
    status: result?.status,
    streamingText,
    isGenerating,
    hasConversation: Boolean(conversation),
    regenerate,
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

/** Header badge for a 摘要 blind: live character count of the summary text. */
export const SessionSummaryCount = observer(function SessionSummaryCount({
  summary,
}: {
  summary: ReturnType<typeof useSessionSummary>;
}) {
  if (!summary.hasConversation) return null;
  const length = summary.streamingText.length || summary.summary?.text.length || 0;
  return <span className="px-1.5 font-mono text-[11px] text-foreground-passive">{length}</span>;
});

/**
 * Inline controls for the 摘要 display: a (re)generate button and a popover to
 * view/manage which Agent drives summary generation. Lives inside the content
 * area (not the blind header) so it sits right next to the summary it controls.
 */
export const SummaryInlineControls = observer(function SummaryInlineControls({
  summary,
}: {
  summary: ReturnType<typeof useSessionSummary>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        className="flex size-5 items-center justify-center rounded-sm text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border disabled:opacity-50"
        aria-label={t('tasks.sessionPanel.summaryRegenerate')}
        title={t('tasks.sessionPanel.summaryRegenerate')}
        disabled={summary.isGenerating}
        onClick={() => summary.regenerate()}
      >
        <RefreshCw className={cn('size-3', summary.isGenerating && 'animate-spin')} />
      </button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="flex size-5 items-center justify-center rounded-sm text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
              aria-label={t('tasks.sessionPanel.summaryConfigure')}
              title={t('tasks.sessionPanel.summaryConfigure')}
            >
              <SlidersHorizontal className="size-3" />
            </button>
          }
        />
        <PopoverContent align="end" side="bottom" className="w-72 gap-0 p-2.5">
          <SummaryConfigFields />
        </PopoverContent>
      </Popover>
    </div>
  );
});

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

  // Live stream takes precedence so the summary visibly types in (SSE).
  const streaming = summary.streamingText.trim();
  // Otherwise fall back to the last persisted summary — kept until the next one
  // is ready, so a regeneration never blanks the panel.
  const text = streaming || summary.summary?.text || '';

  // Only show the empty/explanatory state when there is genuinely nothing to
  // display and nothing streaming in. A running agent no longer hides a
  // previously generated summary.
  if (!text) {
    if (summary.isGenerating) {
      return (
        <div className="flex items-center gap-1.5 px-3.5 py-3 text-xs text-foreground-passive">
          <Loader2 className="size-3 animate-spin" />
          {t('tasks.sessionPanel.summaryGenerating')}
        </div>
      );
    }
    const empty = emptySummaryCopy(summary.status);
    return (
      <div className="flex flex-col gap-2 px-2.5 py-3">
        <EmptyState label={t(empty.label)} description={t(empty.description)} />
        <div className="flex items-center justify-center">
          <Button type="button" size="xs" variant="outline" onClick={() => summary.regenerate()}>
            <RefreshCw className="size-3" />
            {t('tasks.sessionPanel.summaryGenerate')}
          </Button>
        </div>
      </div>
    );
  }

  const timestamp =
    !streaming && summary.summary?.timestamp
      ? new Date(summary.summary.timestamp).toLocaleString()
      : null;

  return (
    <div className="flex min-w-0 flex-col gap-1.5 px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex items-center gap-1 truncate text-[10px] text-foreground-passive">
          {summary.isGenerating ? <Loader2 className="size-2.5 shrink-0 animate-spin" /> : null}
          {streaming || summary.isGenerating
            ? t('tasks.sessionPanel.summaryGenerating')
            : summary.status === 'generated'
              ? t('tasks.sessionPanel.summaryGenerated')
              : t('tasks.sessionPanel.summaryFromCompaction')}
        </span>
        {timestamp ? (
          <span className="font-mono text-[10px] text-foreground-passive">{timestamp}</span>
        ) : null}
        <span className="ml-auto">
          <SummaryInlineControls summary={summary} />
        </span>
      </div>
      <div className="max-h-[60vh] min-w-0 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background-1/40 px-2.5 py-2 text-[11px] leading-relaxed text-foreground-muted">
        {text}
      </div>
    </div>
  );
});

async function resolveSessionSummary(
  conversation: Conversation,
  scope: SessionSummaryScope,
  projectId: string,
  taskId: string,
  cwd: string,
  force?: boolean
): Promise<SessionSummaryResult> {
  try {
    return await rpc.conversations.getSessionSummary(
      conversation.runtimeId,
      scope,
      projectId,
      taskId,
      cwd,
      conversation.id,
      conversation.title,
      conversation.createdAt ?? null,
      force
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
    if (conversation.runtimeId === 'claude') {
      const context = await rpc.conversations.getClaudeSessionContext(
        cwd,
        sessionId || conversation.id
      );
      return context?.prompts ?? [];
    }

    if (conversation.runtimeId === 'codex') {
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

function SessionTitleInfoValue({
  label,
  value,
  conversation,
}: {
  label: string;
  value: string;
  conversation: Conversation;
}) {
  const { t } = useTranslation();
  const provisionedTask = useProvisionedTask();
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isNamingSnapshotLoading, setIsNamingSnapshotLoading] = useState(false);
  const [namingSnapshot, setNamingSnapshot] = useState<ConversationNamingSnapshot | null>(null);
  const loadNamingSnapshot = useCallback(async (): Promise<ConversationNamingSnapshot | null> => {
    const snapshot = await rpc.conversations.getConversationNamingSnapshot(
      conversation.projectId,
      conversation.taskId,
      conversation.id
    );
    if (snapshot?.prompt || snapshot?.context?.sources.length) return snapshot;

    const preview = await rpc.conversations.getConversationNamingPreview(
      conversation.projectId,
      conversation.taskId,
      conversation.id,
      provisionedTask.path
    );
    return snapshot
      ? {
          ...preview,
          status: snapshot.status,
          generatedTitle: snapshot.generatedTitle,
          error: snapshot.error,
          createdAt: snapshot.createdAt,
          updatedAt: snapshot.updatedAt,
        }
      : preview;
  }, [conversation.id, conversation.projectId, conversation.taskId, provisionedTask.path]);

  useEffect(() => {
    setNamingSnapshot(null);
  }, [conversation.id]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setIsNamingSnapshotLoading(true);
    void loadNamingSnapshot()
      .then((snapshot) => {
        if (!cancelled) setNamingSnapshot(snapshot);
      })
      .catch(() => {
        if (!cancelled) setNamingSnapshot(null);
      })
      .finally(() => {
        if (!cancelled) setIsNamingSnapshotLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadNamingSnapshot, open]);

  useEffect(() => {
    if (!open) return;
    return events.on(conversationNamingUpdatedChannel, (snapshot) => {
      if (
        snapshot.projectId !== conversation.projectId ||
        snapshot.taskId !== conversation.taskId ||
        snapshot.conversationId !== conversation.id
      ) {
        return;
      }
      setNamingSnapshot(snapshot);
    });
  }, [conversation.id, conversation.projectId, conversation.taskId, open]);

  const renameToTitle = async (title: string, options: { close?: boolean } = {}) => {
    const nextTitle = title.trim();
    if (!nextTitle || nextTitle === conversation.title || isSaving) return;

    setIsSaving(true);
    try {
      await provisionedTask.conversations.renameConversation(conversation.id, nextTitle);
      if (options.close !== false) setOpen(false);
    } catch (error) {
      toast({
        title: t('tasks.sessionInfo.renameFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const generateWithNamingAgent = async () => {
    if (isGenerating || isSaving) return;

    setIsGenerating(true);
    try {
      const result = await rpc.conversations.generateConversationTitle(
        conversation.projectId,
        conversation.taskId,
        conversation.id,
        provisionedTask.path
      );
      setNamingSnapshot(result.snapshot);
      await renameToTitle(result.title);
      toast({
        title: t('tasks.sessionInfo.agentRenameComplete'),
        description: result.model ? `${result.runtimeName} · ${result.model}` : result.runtimeName,
      });
    } catch (error) {
      void loadNamingSnapshot()
        .then((snapshot) => setNamingSnapshot(snapshot))
        .catch(() => setNamingSnapshot(null));
      toast({
        title: t('tasks.sessionInfo.agentRenameFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="col-span-2 grid min-w-0 grid-cols-subgrid items-center gap-x-2 text-[11px] leading-tight">
      <span className="truncate text-foreground-passive" title={label}>
        {label}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="flex min-w-0 cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 text-left text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
              title={value}
            >
              <span className="min-w-0 truncate">{value}</span>
              <Pencil className="ml-auto size-3 shrink-0 text-foreground-passive" />
            </button>
          }
        />
        <PopoverContent
          align="start"
          side="bottom"
          className="max-h-[70vh] w-80 overflow-y-auto p-0"
        >
          <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
            <NamingDebugContent chromeless>
              <SessionNamingDebugPanel
                snapshot={namingSnapshot}
                isLoading={isNamingSnapshotLoading}
                isGenerating={isGenerating}
                isSaving={isSaving}
                currentTitle={conversation.title}
                branchName={provisionedTask.workspace.git.branchName ?? '-'}
                conversationId={conversation.id}
                onRenameTitle={async (title) => {
                  await renameToTitle(title, { close: false });
                }}
                onRegenerate={generateWithNamingAgent}
              />
            </NamingDebugContent>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function SessionNamingDebugPanel({
  snapshot,
  isLoading,
  isGenerating,
  isSaving,
  currentTitle,
  branchName,
  conversationId,
  onRenameTitle,
  onRegenerate,
}: {
  snapshot: ConversationNamingSnapshot | null;
  isLoading: boolean;
  isGenerating: boolean;
  isSaving: boolean;
  currentTitle: string;
  branchName: string;
  conversationId: string;
  onRenameTitle: (title: string) => Promise<void>;
  onRegenerate: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const isRunning = isGenerating || snapshot?.status === 'generating';
  // Tick once a second while naming is running so the elapsed time updates live;
  // otherwise the panel only re-renders on snapshot changes and the duration
  // would appear frozen.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning) return;
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [isRunning]);
  const status = t(getSessionNamingStatusKey(snapshot, isGenerating));
  const duration = getSessionNamingDurationEstimate(snapshot, nowMs, isRunning);
  const context = snapshot?.context ?? null;
  const contextStats = getNamingDebugContextStats(context);
  const model =
    snapshot?.model ||
    context?.model ||
    snapshot?.runtimeName ||
    t('tasks.rename.modelUnavailable');
  const idPrefix = `session-title:${snapshot?.conversationId ?? 'preview'}`;

  const copyDebugReport = async () => {
    if (!snapshot) return;
    try {
      const result = await rpc.app.clipboardWriteText(buildSessionNamingDebugReport(snapshot));
      if (!result?.success) throw new Error(result?.error ?? t('common.copyFailed'));
      toast({ title: t('common.copied') });
    } catch {
      toast({
        title: t('common.copyFailed'),
        description: t('tasks.panel.copyFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <NamingPanel
      tabStateId={`session-title:${conversationId}:tab`}
      manual={{
        currentName: currentTitle,
        onRename: onRenameTitle,
      }}
      autoPanel={{
        summaryItems: buildNamingSummaryItems(t, {
          statusLabel: status,
          accent: isGenerating || snapshot?.status === 'generating',
          model,
          durationLabel: duration?.duration ?? t('tasks.rename.durationUnavailable'),
          contextTokens: context?.estimatedTokens,
          currentName: currentTitle,
          generatedName: snapshot?.generatedTitle ?? t('tasks.panel.noGeneratedTaskName'),
          branchName,
        }),
        error: snapshot?.error
          ? {
              message: snapshot.error,
              copyLabel: t('common.copy'),
              onCopy: () => void copyDebugReport(),
            }
          : undefined,
        actions: (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="xs"
              variant="default"
              className="flex-1"
              disabled={isGenerating || isSaving}
              onClick={() => void onRegenerate()}
            >
              <RefreshCw className={cn('size-3', isRunning && 'animate-spin')} />
              {isRunning
                ? t('tasks.rename.aiNaming', { duration: duration?.duration ?? '' })
                : t('tasks.rename.aiName')}
            </Button>
          </div>
        ),
        configuration: <NamingPanelConfiguration id={`${idPrefix}:configure`} t={t} />,
        textSections: buildNamingTextSections(t, idPrefix, {
          systemPrompt: snapshot?.systemPrompt,
          systemPromptTokens: snapshot?.systemPromptEstimatedTokens,
          prompt: snapshot?.prompt,
          promptTokens: snapshot?.promptEstimatedTokens,
        }),
        context: buildNamingContextSection(t, {
          context,
          isLoading,
          sourceIdPrefix: idPrefix,
          contextStats,
        }),
      }}
    />
  );
}

function getSessionNamingStatusKey(
  snapshot: ConversationNamingSnapshot | null,
  isGenerating: boolean
): string {
  if (isGenerating || snapshot?.status === 'generating') return 'tasks.rename.statusGenerating';
  if (snapshot?.status === 'ready') return 'tasks.rename.statusReady';
  if (snapshot?.status === 'failed') return 'tasks.rename.statusFailed';
  return 'tasks.rename.statusIdle';
}

function getSessionNamingDurationEstimate(
  snapshot: ConversationNamingSnapshot | null,
  nowMs: number,
  isRunning: boolean
): { duration: string; running: boolean } | null {
  return getNamingDebugDurationEstimate({
    status: snapshot?.status,
    createdAt: snapshot?.createdAt,
    updatedAt: snapshot?.updatedAt,
    traceDurationMs: snapshot?.context?.debugTrace?.totalDurationMs,
    isRunning,
    nowMs,
  });
}

function buildSessionNamingDebugReport(snapshot: ConversationNamingSnapshot): string {
  const lines = [
    '# Session Naming Debug Report',
    `conversationId: ${snapshot.conversationId}`,
    `projectId: ${snapshot.projectId}`,
    `taskId: ${snapshot.taskId}`,
    `status: ${snapshot.status}`,
    `runtimeId: ${snapshot.runtimeId ?? '-'}`,
    `runtimeName: ${snapshot.runtimeName ?? '-'}`,
    `model: ${snapshot.model ?? '-'}`,
    `systemPromptEstimatedTokens: ${snapshot.systemPromptEstimatedTokens ?? '-'}`,
    `promptChars: ${snapshot.promptChars ?? '-'}`,
    `promptEstimatedTokens: ${snapshot.promptEstimatedTokens ?? '-'}`,
    `generatedTitle: ${snapshot.generatedTitle ?? '-'}`,
    `error: ${snapshot.error ?? '-'}`,
    `createdAt: ${snapshot.createdAt}`,
    `updatedAt: ${snapshot.updatedAt}`,
  ];

  const debugTrace = snapshot.context?.debugTrace;
  if (debugTrace) {
    lines.push(`trace.totalDurationMs: ${debugTrace.totalDurationMs}`);
    for (const stage of debugTrace.stages) {
      lines.push(`trace.stage: ${JSON.stringify(stage)}`);
    }
  }

  if (snapshot.systemPrompt) {
    lines.push('', '## System Prompt', snapshot.systemPrompt);
  }

  if (snapshot.prompt) {
    lines.push('', '## Final Prompt Sent', snapshot.prompt);
  }

  if (snapshot.context?.sources.length) {
    lines.push('', '## Context Sources');
    for (const source of snapshot.context.sources) {
      lines.push(
        `### ${source.label} (tokens=${source.estimatedTokens}${source.truncated ? ', truncated' : ''})`,
        source.content
      );
    }
  }

  return lines.join('\n');
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

function SessionInfoTimeValue({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="col-span-2 grid min-w-0 grid-cols-subgrid items-center gap-x-2 text-[11px] leading-tight">
      <span className="truncate text-foreground-passive" title={label}>
        {label}
      </span>
      <span className="min-w-0 truncate text-foreground-muted" title={value}>
        <RelativeTime value={value} />
      </span>
    </div>
  );
}

function SessionInfoDivider() {
  return <div className="col-span-2 my-0.5 h-px bg-border/70" />;
}
