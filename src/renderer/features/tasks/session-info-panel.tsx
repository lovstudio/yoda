import {
  Copy,
  Info,
  Loader2,
  Maximize2,
  MoreHorizontal,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
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
  SessionSummarySnapshot,
  SessionSummaryStatus,
} from '@shared/conversations';
import { conversationNamingUpdatedChannel } from '@shared/events/conversationEvents';
import {
  sessionSummarySnapshotUpdatedChannel,
  sessionSummaryStreamChannel,
  sessionSummaryTopic,
} from '@shared/events/sessionSummaryEvents';
import {
  formatNamingDebugTokenCount,
  getNamingDebugContextStats,
  getNamingDebugDurationEstimate,
  NamingDebugContent,
  NamingDebugPanel,
} from '@renderer/features/tasks/components/naming-debug-ui';
import {
  buildNamingContextSection,
  buildNamingSummaryItems,
  buildNamingTextSections,
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
import { useTaskStats } from '@renderer/features/tasks/hooks/useTaskStats';
import { buildPromptPreviewItems } from '@renderer/features/tasks/session-prompts-preview';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { toast } from '@renderer/lib/hooks/use-toast';
import { events, rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { Input } from '@renderer/lib/ui/input';
import { MicroLabel } from '@renderer/lib/ui/label';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@renderer/lib/ui/tabs';
import { Textarea } from '@renderer/lib/ui/textarea';
import { isImeComposing } from '@renderer/utils/ime';
import { cn } from '@renderer/utils/utils';

/** Poll interval for the live prompt count in the 对话 blind header. */
const PROMPTS_REFRESH_MS = 3_000;

/**
 * Shared loader for the 基础/状态 blinds: the active conversation, its live
 * store/status, and the resolved session fields (tmux, process, resume
 * command, …). Each blind mounts its own instance — the accordion is
 * single-expand, so only one resolve loop is live at a time.
 */
function useSessionInfoFields(active: boolean) {
  const provisionedTask = useProvisionedTask();
  const conversation = getTaskMenuConversation(provisionedTask);
  // Observe the live PTY session status so the panel re-fetches session info
  // (e.g. tmux enabled/disabled) whenever the session restarts — from this
  // panel's button or from a context-menu "restart with/without tmux".
  const conversationStore = conversation
    ? provisionedTask.conversations.conversations.get(conversation.id)
    : undefined;
  const sessionStatus = conversationStore?.session.status;
  const agentRuntimeStatus = conversationStore?.status;
  const [isLoading, setIsLoading] = useState(false);
  const [resolvedFields, setResolvedFields] = useState<TaskMenuSessionFields | undefined>();

  const fallbackFields = conversation
    ? buildTaskMenuSessionFields(conversation, provisionedTask.path)
    : undefined;
  const fields = fallbackFields || resolvedFields ? { ...fallbackFields, ...resolvedFields } : null;

  useEffect(() => {
    // Reset on conversation switch so stale fields never flash.
    setResolvedFields(undefined); // eslint-disable-line react-hooks/set-state-in-effect
  }, [conversation?.id]);

  useEffect(() => {
    if (!active || !conversation) return;
    let cancelled = false;
    setIsLoading(true); // eslint-disable-line react-hooks/set-state-in-effect
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
  }, [active, agentRuntimeStatus, conversation, provisionedTask.path, sessionStatus]);

  return {
    provisionedTask,
    conversation,
    conversationStore,
    sessionStatus,
    agentRuntimeStatus,
    fields,
    isLoading,
  };
}

/** Shared shell for the 基础/状态 blinds (header only when not chromeless). */
function SessionInfoShell({
  title,
  isLoading,
  chromeless,
  children,
}: {
  title: string;
  isLoading: boolean;
  chromeless: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex w-full flex-col overflow-hidden',
        chromeless ? 'min-h-0' : 'h-full bg-background'
      )}
    >
      {chromeless ? null : (
        <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-border/70 pl-3 pr-1.5">
          <MicroLabel className="truncate text-foreground-passive">{title}</MicroLabel>
          {isLoading ? <Loader2 className="size-3.5 animate-spin text-foreground-passive" /> : null}
        </div>
      )}
      <div className={cn('px-2.5 py-2', chromeless ? 'min-w-0' : 'min-h-0 flex-1 overflow-y-auto')}>
        {children}
      </div>
    </div>
  );
}

/** Group heading inside the meta grid — the 项目/任务/会话 hierarchy levels. */
function SessionInfoGroupLabel({ label, divider = false }: { label: string; divider?: boolean }) {
  return (
    <>
      {divider ? <SessionInfoDivider /> : null}
      <div className="col-span-2 pt-0.5">
        <MicroLabel className="text-foreground-passive">{label}</MicroLabel>
      </div>
    </>
  );
}

/**
 * The 基础 blind: the session's full fact sheet, ordered static → dynamic in
 * five segments — 位置 (project/task), 会话身份, 运行状态, Token 用量, 时间线.
 * Title/summary live in `SessionOverviewPanel`.
 */
export const SessionInfoPanel = observer(function SessionInfoPanel({
  active,
  chromeless = false,
}: {
  active: boolean;
  chromeless?: boolean;
}) {
  const { t } = useTranslation();
  const {
    provisionedTask,
    conversation,
    conversationStore,
    sessionStatus,
    agentRuntimeStatus,
    fields,
    isLoading,
  } = useSessionInfoFields(active);
  const { projectId, taskId } = useTaskViewContext();
  // Per-session token burn, parsed from the provider transcript by the stats
  // domain. Task-level fetch (cached/shared via react-query) narrowed to this
  // conversation; null when the runtime has no transcript reader.
  const { data: taskStats } = useTaskStats(projectId, taskId, { enabled: active });
  const sessionTokens = conversation
    ? (taskStats?.conversations.find((item) => item.conversationId === conversation.id)?.tokens ??
      null)
    : null;

  const branchName = provisionedTask.workspace.git.branchName ?? provisionedTask.taskBranch;
  const yesNo = (value: boolean | null | undefined): string | undefined => {
    if (value == null) return undefined;
    return value ? t('common.yes') : t('common.no');
  };
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
  const processStatus = fields?.process?.status
    ? t(`tasks.sessionInfo.processStatus.${fields.process.status}`)
    : undefined;
  const agentStatus = agentRuntimeStatus
    ? t(`tasks.sessionInfo.agentStatus.${agentRuntimeStatus}`)
    : undefined;
  const ptyStatus = sessionStatus ? t(`tasks.sessionInfo.ptyStatus.${sessionStatus}`) : undefined;

  return (
    <SessionInfoShell
      title={t('tasks.sessionInfo.title')}
      isLoading={isLoading}
      chromeless={chromeless}
    >
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
            <SessionInfoValue
              label={t('tasks.sessionInfo.projectId')}
              value={conversation.projectId}
              mono
              copyable
            />
            <SessionInfoValue
              label={t('tasks.sessionInfo.workingDirectory')}
              value={fields.workingDirectory}
              mono
              copyable
            />
            <SessionInfoDivider />
            <SessionInfoValue
              label={t('tasks.sessionInfo.taskId')}
              value={conversation.taskId}
              mono
              copyable
            />
            <SessionInfoValue
              label={t('tasks.sessionInfo.branch')}
              value={branchName}
              mono
              copyable
            />
            <SessionInfoDivider />
            <SessionInfoValue
              label={t('tasks.sessionInfo.runtimeSessionId')}
              value={fields.sessionId}
              mono
              copyable
            />
            <SessionInfoValue
              label={t('tasks.context.taskInfo.provider')}
              value={fields.runtimeName}
            />
            <SessionInfoValue
              label={t('tasks.sessionInfo.contentSource')}
              value={fields.contentSourcePath}
              mono
              copyable
              info={t('tasks.sessionInfo.fieldInfo.contentSource')}
            />
            <SessionInfoValue
              label={t('tasks.sessionInfo.autoApprove')}
              value={yesNo(conversation.autoApprove)}
              info={t('tasks.sessionInfo.fieldInfo.autoApprove')}
            />
            <SessionInfoValue
              label={t('tasks.sessionInfo.resumeCommand')}
              value={fields.resumeCommand}
              mono
              copyable
              info={t('tasks.sessionInfo.fieldInfo.resumeCommand')}
            />
            <SessionInfoDivider />
            <SessionInfoValue
              label={t('tasks.sessionInfo.agentStatusLabel')}
              value={agentStatus}
              info={t('tasks.sessionInfo.fieldInfo.agentStatus')}
            />
            <SessionInfoValue
              label={t('tasks.sessionInfo.runtimeRunning')}
              value={runningStatus}
              info={t('tasks.sessionInfo.fieldInfo.runtimeRunning')}
            />
            <SessionInfoValue
              label={t('tasks.sessionInfo.tmux')}
              value={tmuxStatus}
              info={t('tasks.sessionInfo.fieldInfo.tmux')}
            />
            <SessionInfoValue
              label={t('tasks.sessionInfo.ptyStatusLabel')}
              value={ptyStatus}
              info={t('tasks.sessionInfo.fieldInfo.ptyStatus')}
            />
            <SessionInfoValue
              label={t('tasks.sessionInfo.ptySessionId')}
              value={conversationStore?.session.sessionId}
              mono
              copyable
              info={t('tasks.sessionInfo.fieldInfo.ptySessionId')}
            />
            {fields.process?.pid !== undefined ? (
              <SessionInfoValue
                label={t('tasks.sessionInfo.processPid')}
                value={String(fields.process.pid)}
                mono
                copyable
              />
            ) : null}
            {processStatus ? (
              <SessionInfoValue
                label={t('tasks.sessionInfo.processStatusLabel')}
                value={processStatus}
                info={t('tasks.sessionInfo.fieldInfo.processStatus')}
              />
            ) : null}
            <SessionInfoTimeValue
              label={t('tasks.sessionInfo.processUpdatedAt')}
              value={fields.process?.updatedAt}
              info={t('tasks.sessionInfo.fieldInfo.processUpdatedAt')}
            />
            <SessionInfoValue
              label={t('tasks.sessionInfo.sessionExited')}
              value={yesNo(conversationStore?.sessionExited)}
              info={t('tasks.sessionInfo.fieldInfo.sessionExited')}
            />
            <SessionInfoValue
              label={t('tasks.sessionInfo.seen')}
              value={yesNo(conversationStore?.seen)}
              info={t('tasks.sessionInfo.fieldInfo.seen')}
            />
            {sessionTokens ? (
              <>
                <SessionInfoGroupLabel label={t('tasks.sessionInfo.tokenUsage')} divider />
                <SessionInfoValue
                  label={t('tasks.sessionInfo.tokenTotal')}
                  value={sessionTokens.total.toLocaleString()}
                  mono
                />
                <SessionInfoValue
                  label={t('tasks.sessionInfo.tokenInput')}
                  value={sessionTokens.input.toLocaleString()}
                  mono
                />
                <SessionInfoValue
                  label={t('tasks.sessionInfo.tokenOutput')}
                  value={sessionTokens.output.toLocaleString()}
                  mono
                />
                {sessionTokens.reasoning > 0 ? (
                  <SessionInfoValue
                    label={t('tasks.sessionInfo.tokenReasoning')}
                    value={sessionTokens.reasoning.toLocaleString()}
                    mono
                  />
                ) : null}
                <SessionInfoValue
                  label={t('tasks.sessionInfo.tokenCacheRead')}
                  value={sessionTokens.cacheRead.toLocaleString()}
                  mono
                />
                <SessionInfoValue
                  label={t('tasks.sessionInfo.tokenCacheCreation')}
                  value={sessionTokens.cacheCreation.toLocaleString()}
                  mono
                />
              </>
            ) : null}
            <SessionInfoDivider />
            <SessionInfoTimeValue
              label={t('tasks.sessionInfo.createdAt')}
              value={conversation.createdAt}
            />
            <SessionInfoTimeValue
              label={t('tasks.sessionInfo.updatedAt')}
              value={conversation.updatedAt}
              info={t('tasks.sessionInfo.fieldInfo.updatedAt')}
            />
            <SessionInfoTimeValue
              label={t('tasks.sessionInfo.lastInteractedAt')}
              value={conversation.lastInteractedAt}
              info={t('tasks.sessionInfo.fieldInfo.lastInteractedAt')}
            />
            <SessionInfoTimeValue
              label={t('tasks.sessionInfo.archivedAt')}
              value={conversation.archivedAt}
            />
          </section>
        </div>
      )}
    </SessionInfoShell>
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

/** Header badge for summary blinds: present summary, in-progress generation, or nothing. */
export const SessionSummaryCount = observer(function SessionSummaryCount({
  summary,
}: {
  summary: ReturnType<typeof useSessionSummary>;
}) {
  if (!summary.hasConversation) return null;
  const length = summary.streamingText.length || summary.summary?.text.length || 0;
  return <span className="px-1.5 font-mono text-[11px] text-foreground-passive">{length}</span>;
});

/** Content of a summary blind: current/streaming summary plus generation controls. */
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
  const sourceLabel =
    streaming || summary.isGenerating
      ? t('tasks.sessionPanel.summaryGenerating')
      : summary.status === 'manual'
        ? t('tasks.sessionInfo.summarySourceManual')
        : summary.status === 'generated'
          ? t('tasks.sessionPanel.summaryGenerated')
          : t('tasks.sessionPanel.summaryFromCompaction');

  return (
    <div className="flex min-w-0 flex-col gap-1.5 px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex items-center gap-1 truncate text-[10px] text-foreground-passive">
          {summary.isGenerating ? <Loader2 className="size-2.5 shrink-0 animate-spin" /> : null}
          {sourceLabel}
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

export function SessionPromptsPreview({
  prompts,
  isLoading,
  onOpenAll,
  onPromptClick,
}: {
  prompts: ClaudeSessionPrompt[];
  isLoading: boolean;
  onOpenAll: () => void;
  /** When set, clicking a prompt row calls this instead of opening the full modal. */
  onPromptClick?: (prompt: ClaudeSessionPrompt, promptIndex: number) => void;
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
                onClick={
                  onPromptClick ? () => onPromptClick(item.prompt, item.promptIndex) : onOpenAll
                }
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

/**
 * Inline-editable title of the 概要 blind: click the text to edit in place,
 * Enter/blur saves, Esc cancels — no extra affordance.
 */
const OverviewTitleInline = observer(function OverviewTitleInline({
  conversation,
}: {
  conversation: Conversation;
}) {
  const { t } = useTranslation();
  const provisionedTask = useProvisionedTask();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const save = async () => {
    const next = value.trim();
    setEditing(false);
    if (!next || next === conversation.title || isSaving) return;
    setIsSaving(true);
    try {
      await provisionedTask.conversations.renameConversation(conversation.id, next);
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

  if (editing) {
    return (
      <Input
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            setEditing(false);
            return;
          }
          if (event.key === 'Enter' && !isImeComposing(event)) {
            event.preventDefault();
            void save();
          }
        }}
        className="h-8 px-1 text-center text-base font-semibold"
      />
    );
  }
  // Article-style heading: centered, prominent, wraps instead of truncating,
  // with a subtle bottom border setting it apart from the summary body.
  return (
    <button
      type="button"
      className="min-w-0 rounded-sm border-b border-border/70 px-1 pb-1.5 pt-1 text-center text-base font-semibold leading-snug text-foreground transition-colors hover:bg-background-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
      title={conversation.title}
      onClick={() => {
        setValue(conversation.title);
        setEditing(true);
      }}
    >
      <span className="block break-words">{conversation.title}</span>
    </button>
  );
});

/**
 * The single AI entry of the 概要 blind, rendered in the blind header. Opens a
 * popover unifying both generators — 摘要 and 标题 tabs, each with context
 * sources, configuration and a generate action.
 */
export const SessionOverviewAIButton = observer(function SessionOverviewAIButton() {
  const { t } = useTranslation();
  const provisionedTask = useProvisionedTask();
  const conversation = getTaskMenuConversation(provisionedTask);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'summary' | 'title'>('summary');
  if (!conversation) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
            aria-label={t('tasks.sessionInfo.overviewAi')}
            title={t('tasks.sessionInfo.overviewAi')}
            onClick={(event) => event.stopPropagation()}
          >
            <Sparkles className="size-3" />
          </button>
        }
      />
      <PopoverContent align="end" side="bottom" className="max-h-[70vh] w-96 overflow-y-auto p-0">
        <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
          <NamingDebugContent chromeless>
            <Tabs value={tab} onValueChange={(next) => setTab(next as 'summary' | 'title')}>
              <TabsList>
                <TabsIndicator />
                <TabsTab value="summary">{t('tasks.sessionInfo.summaryLabel')}</TabsTab>
                <TabsTab value="title">{t('tasks.sessionInfo.sessionTitle')}</TabsTab>
              </TabsList>
              <TabsPanel value="summary" className="flex min-h-0 flex-1 flex-col">
                <OverviewSummaryTab
                  key={conversation.id}
                  conversation={conversation}
                  active={open && tab === 'summary'}
                />
              </TabsPanel>
              <TabsPanel value="title" className="flex min-h-0 flex-1 flex-col">
                <OverviewTitleTab
                  key={conversation.id}
                  conversation={conversation}
                  active={open && tab === 'title'}
                />
              </TabsPanel>
            </Tabs>
          </NamingDebugContent>
        </div>
      </PopoverContent>
    </Popover>
  );
});

/** The 标题 tab of the AI popover: naming debug + generate. */
const OverviewTitleTab = observer(function OverviewTitleTab({
  conversation,
  active,
}: {
  conversation: Conversation;
  active: boolean;
}) {
  const { t } = useTranslation();
  const provisionedTask = useProvisionedTask();
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
    if (!active) return;
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
  }, [loadNamingSnapshot, active]);

  useEffect(() => {
    if (!active) return;
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
  }, [conversation.id, conversation.projectId, conversation.taskId, active]);

  const renameToTitle = async (title: string) => {
    const nextTitle = title.trim();
    if (!nextTitle || nextTitle === conversation.title || isSaving) return;

    setIsSaving(true);
    try {
      await provisionedTask.conversations.renameConversation(conversation.id, nextTitle);
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
    <SessionNamingDebugPanel
      snapshot={namingSnapshot}
      isLoading={isNamingSnapshotLoading}
      isGenerating={isGenerating}
      isSaving={isSaving}
      currentTitle={conversation.title}
      branchName={provisionedTask.workspace.git.branchName ?? '-'}
      onRegenerate={generateWithNamingAgent}
    />
  );
});

function SessionNamingDebugPanel({
  snapshot,
  isLoading,
  isGenerating,
  isSaving,
  currentTitle,
  branchName,
  onRegenerate,
}: {
  snapshot: ConversationNamingSnapshot | null;
  isLoading: boolean;
  isGenerating: boolean;
  isSaving: boolean;
  currentTitle: string;
  branchName: string;
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
    <NamingDebugPanel
      summaryItems={buildNamingSummaryItems(t, {
        statusLabel: status,
        accent: isGenerating || snapshot?.status === 'generating',
        model,
        durationLabel: duration?.duration ?? t('tasks.rename.durationUnavailable'),
        contextTokens: context?.estimatedTokens,
        currentName: currentTitle,
        generatedName: snapshot?.generatedTitle ?? t('tasks.panel.noGeneratedTaskName'),
        branchName,
      })}
      error={
        snapshot?.error
          ? {
              message: snapshot.error,
              copyLabel: t('common.copy'),
              onCopy: () => void copyDebugReport(),
            }
          : undefined
      }
      actions={
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
      }
      configuration={<NamingPanelConfiguration id={`${idPrefix}:configure`} t={t} />}
      textSections={buildNamingTextSections(t, idPrefix, {
        systemPrompt: snapshot?.systemPrompt,
        systemPromptTokens: snapshot?.systemPromptEstimatedTokens,
        prompt: snapshot?.prompt,
        promptTokens: snapshot?.promptEstimatedTokens,
      })}
      context={buildNamingContextSection(t, {
        context,
        isLoading,
        sourceIdPrefix: idPrefix,
        contextStats,
      })}
      sectionLabels={{
        basics: t('tasks.rename.sectionBasics'),
        configuration: t('tasks.rename.sectionConfig'),
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

/** Where the currently shown summary came from, mirroring `titleSource`. */
function summarySourceLabelKey(status: SessionSummaryStatus | undefined): string | undefined {
  switch (status) {
    case 'manual':
      return 'tasks.sessionInfo.summarySourceManual';
    case 'compaction':
      return 'tasks.sessionInfo.summarySourceRuntime';
    case 'generated':
      return 'tasks.sessionInfo.summarySourceYoda';
    default:
      return undefined;
  }
}

const SUMMARY_LANGUAGE_KEYS: Record<string, string> = {
  app: 'settings.tasks.namingLanguageApp',
  prompt: 'settings.tasks.namingLanguagePrompt',
  en: 'settings.tasks.namingLanguageEn',
  'zh-CN': 'settings.tasks.namingLanguageZh',
};

/**
 * The 概要 blind: title + whole-session summary as a clean reading surface,
 * pinned as the LAST blind so it can stay open beside any conversation.
 * - Title and summary are both edited in place (click the text).
 * - Summary renders as Markdown, auto-expanding — no inner scroll box.
 * - The single AI entry is the Sparkles button in the blind header
 *   (`SessionOverviewAIButton`), unifying title + summary generation.
 */
export const SessionOverviewPanel = observer(function SessionOverviewPanel({
  active,
}: {
  active: boolean;
}) {
  const { t } = useTranslation();
  const provisionedTask = useProvisionedTask();
  const conversation = getTaskMenuConversation(provisionedTask);
  if (!conversation) {
    return (
      <div className="px-2.5 py-3">
        <EmptyState
          label={t('tasks.sessionInfo.noSession')}
          description={t('tasks.sessionInfo.noSessionDescription')}
        />
      </div>
    );
  }
  // Keyed by conversation so every piece of summary state resets on switch.
  return (
    <SessionOverviewContent key={conversation.id} conversation={conversation} active={active} />
  );
});

const SessionOverviewContent = observer(function SessionOverviewContent({
  conversation,
  active,
}: {
  conversation: Conversation;
  active: boolean;
}) {
  const { t } = useTranslation();
  const { projectId, taskId } = useTaskViewContext();
  const provisionedTask = useProvisionedTask();
  // Re-peek when the agent goes idle so the text reflects the latest transcript.
  const sessionStatus = provisionedTask.conversations.conversations.get(conversation.id)?.session
    .status;
  const [streamingText, setStreamingText] = useState('');
  const [result, setResult] = useState<SessionSummaryResult | null>(null);
  // Generation runs from the AI popover in the blind header, never from here —
  // this mirrors its lifecycle off the snapshot channel for the caption.
  const [remoteGenerating, setRemoteGenerating] = useState(false);

  const peek = useCallback(async () => {
    try {
      const next = await rpc.conversations.getSessionSummary(
        conversation.runtimeId,
        'global',
        projectId,
        taskId,
        provisionedTask.path,
        conversation.id,
        conversation.title,
        conversation.createdAt ?? null,
        false,
        true
      );
      setResult(next);
    } catch {
      setResult((prev) => prev ?? { summary: null, status: 'failed' });
    }
  }, [
    conversation.createdAt,
    conversation.id,
    conversation.runtimeId,
    conversation.title,
    projectId,
    provisionedTask.path,
    taskId,
  ]);

  useEffect(() => {
    void peek();
  }, [peek, sessionStatus]);

  // SSE: append streamed deltas while a generation is in flight so the summary
  // visibly types in instead of appearing only when generation finishes.
  useEffect(() => {
    if (!active) return;
    const topic = sessionSummaryTopic(conversation.id, 'global');
    return events.on(
      sessionSummaryStreamChannel,
      (event) => {
        if (event.scope !== 'global') return;
        if (event.done) {
          setStreamingText('');
          return;
        }
        if (event.delta) setStreamingText((prev) => prev + event.delta);
      },
      topic
    );
  }, [active, conversation.id]);

  // Mirror generation lifecycle off the snapshot channel — generation is
  // triggered from the AI popover in the blind header, never from here.
  useEffect(() => {
    if (!active) return;
    return events.on(sessionSummarySnapshotUpdatedChannel, (next) => {
      if (
        next.projectId !== projectId ||
        next.taskId !== taskId ||
        next.conversationId !== conversation.id
      ) {
        return;
      }
      setRemoteGenerating(next.status === 'generating');
      if (next.status === 'ready' || next.status === 'failed') void peek();
    });
  }, [active, conversation.id, peek, projectId, taskId]);

  const saveManual = async (text: string) => {
    try {
      const next = await rpc.conversations.setManualSessionSummary(conversation.id, text);
      if (next.summary) setResult(next);
      else await peek();
    } catch (error) {
      toast({
        title: t('tasks.sessionInfo.summaryManualFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const text = result?.summary?.text ?? '';
  // Live stream takes precedence so the summary visibly types in.
  const displayText = streamingText.trim() || text;
  const generating = remoteGenerating || Boolean(streamingText);
  const sourceKey = summarySourceLabelKey(result?.status);
  const timestamp =
    !streamingText && result?.summary?.timestamp
      ? new Date(result.summary.timestamp).toLocaleString()
      : null;

  return (
    <div className="flex min-w-0 flex-col gap-1 px-2.5 py-2">
      <OverviewTitleInline conversation={conversation} />
      <OverviewSummaryEditor text={text} displayText={displayText} onSave={saveManual} />
      {generating || sourceKey || timestamp ? (
        <div className="flex min-w-0 items-center gap-1.5 px-1 text-[10px] text-foreground-passive">
          {generating ? (
            <>
              <Loader2 className="size-2.5 shrink-0 animate-spin" />
              {t('tasks.sessionPanel.summaryGenerating')}
            </>
          ) : (
            <>
              {sourceKey ? <span className="truncate">{t(sourceKey)}</span> : null}
              {timestamp ? <span className="shrink-0 font-mono">{timestamp}</span> : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
});

/**
 * The summary body: rendered Markdown by default, click anywhere to edit the
 * raw text in place (live-preview style — manual edit and AI generation share
 * this one surface). Blur saves: a changed text pins a manual override,
 * clearing it restores the automatic source. No fixed height — the content
 * auto-expands so it reads without inner scrolling.
 */
function OverviewSummaryEditor({
  text,
  displayText,
  onSave,
}: {
  /** The saved summary text (what editing starts from). */
  text: string;
  /** What to render — live stream first, then the saved text. */
  displayText: string;
  onSave: (text: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  if (editing) {
    return (
      <Textarea
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft.trim() !== text.trim()) void onSave(draft);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            setEditing(false);
          }
        }}
        placeholder={t('tasks.sessionInfo.summaryManualPlaceholder')}
        className="min-h-24 px-1 py-0.5 text-xs leading-relaxed"
      />
    );
  }

  const startEditing = () => {
    setDraft(text);
    setEditing(true);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        // Don't hijack text selection — only a plain click enters edit mode.
        if (window.getSelection()?.toString()) return;
        startEditing();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          startEditing();
        }
      }}
      className="min-w-0 cursor-text rounded-sm px-1 py-0.5 transition-colors hover:bg-background-1/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
    >
      {displayText ? (
        <MarkdownRenderer
          content={displayText}
          variant="compact"
          className="text-xs text-foreground-muted"
        />
      ) : (
        <span className="text-[11px] text-foreground-passive">
          {t('tasks.sessionInfo.overviewSummaryPlaceholder')}
        </span>
      )}
    </div>
  );
}

/** The 摘要 tab of the AI popover: summary debug + generate. */
const OverviewSummaryTab = observer(function OverviewSummaryTab({
  conversation,
  active,
}: {
  conversation: Conversation;
  active: boolean;
}) {
  const { projectId, taskId } = useTaskViewContext();
  const provisionedTask = useProvisionedTask();
  const [result, setResult] = useState<SessionSummaryResult | null>(null);
  const [snapshot, setSnapshot] = useState<SessionSummarySnapshot | null>(null);
  const [isSnapshotLoading, setIsSnapshotLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const peek = useCallback(async () => {
    try {
      const next = await rpc.conversations.getSessionSummary(
        conversation.runtimeId,
        'global',
        projectId,
        taskId,
        provisionedTask.path,
        conversation.id,
        conversation.title,
        conversation.createdAt ?? null,
        false,
        true
      );
      setResult(next);
    } catch {
      setResult((prev) => prev ?? { summary: null, status: 'failed' });
    }
  }, [
    conversation.createdAt,
    conversation.id,
    conversation.runtimeId,
    conversation.title,
    projectId,
    provisionedTask.path,
    taskId,
  ]);

  const loadSnapshot = useCallback(async (): Promise<SessionSummarySnapshot | null> => {
    const current = await rpc.conversations.getSessionSummarySnapshot(
      projectId,
      taskId,
      conversation.id
    );
    if (current?.prompt || current?.context?.sources.length) return current;

    const preview = await rpc.conversations.getSessionSummaryPreview(
      conversation.runtimeId,
      projectId,
      taskId,
      provisionedTask.path,
      conversation.id,
      conversation.title,
      conversation.createdAt ?? null
    );
    return current
      ? {
          ...preview,
          status: current.status,
          generatedSummary: current.generatedSummary,
          error: current.error,
          createdAt: current.createdAt,
          updatedAt: current.updatedAt,
        }
      : preview;
  }, [
    conversation.createdAt,
    conversation.id,
    conversation.runtimeId,
    conversation.title,
    projectId,
    provisionedTask.path,
    taskId,
  ]);

  useEffect(() => {
    if (!active) return;
    void peek();
  }, [active, peek]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setIsSnapshotLoading(true);
    void loadSnapshot()
      .then((next) => {
        if (!cancelled) setSnapshot(next);
      })
      .catch(() => {
        if (!cancelled) setSnapshot(null);
      })
      .finally(() => {
        if (!cancelled) setIsSnapshotLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadSnapshot, active]);

  useEffect(() => {
    if (!active) return;
    return events.on(sessionSummarySnapshotUpdatedChannel, (next) => {
      if (
        next.projectId !== projectId ||
        next.taskId !== taskId ||
        next.conversationId !== conversation.id
      ) {
        return;
      }
      setSnapshot(next);
      if (next.status === 'ready' || next.status === 'failed') void peek();
    });
  }, [active, conversation.id, peek, projectId, taskId]);

  const generate = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      const next = await resolveSessionSummary(
        conversation,
        'global',
        projectId,
        taskId,
        provisionedTask.path,
        true
      );
      // Keep the last summary visible on failure; the panel shows the error.
      setResult((prev) => (next.summary || !prev ? next : prev));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <SessionSummaryDebugPanel
      snapshot={snapshot}
      isLoading={isSnapshotLoading}
      isGenerating={isGenerating}
      currentText={result?.summary?.text ?? ''}
      currentStatus={result?.status}
      conversationId={conversation.id}
      onGenerate={generate}
    />
  );
});

function SessionSummaryDebugPanel({
  snapshot,
  isLoading,
  isGenerating,
  currentText,
  currentStatus,
  conversationId,
  onGenerate,
}: {
  snapshot: SessionSummarySnapshot | null;
  isLoading: boolean;
  isGenerating: boolean;
  currentText: string;
  currentStatus: SessionSummaryStatus | undefined;
  conversationId: string;
  onGenerate: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const isRunning = isGenerating || snapshot?.status === 'generating';
  // Tick once a second while generating so the elapsed time updates live (same
  // rationale as the naming panel).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning) return;
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [isRunning]);
  const status = t(getSessionSummaryStatusKey(snapshot, isGenerating));
  const duration = getNamingDebugDurationEstimate({
    status: snapshot?.status,
    createdAt: snapshot?.createdAt,
    updatedAt: snapshot?.updatedAt,
    traceDurationMs: undefined,
    isRunning,
    nowMs,
  });
  const context = snapshot?.context ?? null;
  const contextStats = getNamingDebugContextStats(context);
  const model = snapshot?.model || snapshot?.runtimeName || t('tasks.rename.modelUnavailable');
  const idPrefix = `session-summary:${conversationId}`;
  const sourceKey = summarySourceLabelKey(currentStatus);
  const languageKey = snapshot?.language ? SUMMARY_LANGUAGE_KEYS[snapshot.language] : undefined;

  const copyDebugReport = async () => {
    if (!snapshot) return;
    try {
      const result = await rpc.app.clipboardWriteText(buildSessionSummaryDebugReport(snapshot));
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
    <NamingDebugPanel
      summaryItems={[
        { label: t('tasks.rename.status'), value: status, accent: isRunning },
        { label: t('tasks.panel.model'), value: model, mono: true },
        {
          label: t('settings.tasks.summaryLanguageLabel'),
          value: languageKey ? t(languageKey) : undefined,
        },
        {
          label: t('tasks.rename.durationEstimate'),
          value: duration?.duration ?? t('tasks.rename.durationUnavailable'),
          mono: true,
        },
        {
          label: t('tasks.rename.contextTokens'),
          value: formatNamingDebugTokenCount(context?.estimatedTokens),
          mono: true,
        },
        { kind: 'divider' },
        {
          label: t('tasks.sessionInfo.summarySource'),
          value: sourceKey ? t(sourceKey) : undefined,
        },
      ]}
      error={
        snapshot?.error
          ? {
              message: snapshot.error,
              copyLabel: t('common.copy'),
              onCopy: () => void copyDebugReport(),
            }
          : undefined
      }
      actions={
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="xs"
            variant="default"
            className="flex-1"
            disabled={isRunning}
            onClick={() => void onGenerate()}
          >
            <RefreshCw className={cn('size-3', isRunning && 'animate-spin')} />
            {isRunning
              ? t('tasks.sessionPanel.summaryGenerating')
              : t('tasks.sessionPanel.summaryGenerate')}
          </Button>
        </div>
      }
      configuration={
        <NamingPanelConfiguration
          id={`${idPrefix}:configure`}
          t={t}
          hint={t('settings.tasks.summaryConfigDescription')}
        >
          <SummaryConfigFields />
        </NamingPanelConfiguration>
      }
      textSections={[
        {
          id: `${idPrefix}:current`,
          label: t('tasks.sessionInfo.summaryCurrent'),
          text: currentText || undefined,
          maxHeightClassName: 'max-h-48',
        },
        {
          id: `${idPrefix}:generated`,
          label: t('tasks.sessionInfo.summaryGeneratedResult'),
          text: snapshot?.generatedSummary,
          maxHeightClassName: 'max-h-48',
        },
        ...buildNamingTextSections(t, idPrefix, {
          systemPrompt: snapshot?.systemPrompt,
          systemPromptTokens: snapshot?.systemPromptEstimatedTokens,
          prompt: snapshot?.prompt,
          promptTokens: snapshot?.promptEstimatedTokens,
        }),
      ]}
      context={buildNamingContextSection(t, {
        context,
        isLoading,
        sourceIdPrefix: idPrefix,
        contextStats,
      })}
      sectionLabels={{
        basics: t('tasks.rename.sectionBasics'),
        configuration: t('tasks.rename.sectionConfig'),
      }}
    />
  );
}

function getSessionSummaryStatusKey(
  snapshot: SessionSummarySnapshot | null,
  isGenerating: boolean
): string {
  if (isGenerating || snapshot?.status === 'generating') return 'tasks.rename.statusGenerating';
  if (snapshot?.status === 'ready') return 'tasks.rename.statusReady';
  if (snapshot?.status === 'failed') return 'tasks.rename.statusFailed';
  return 'tasks.rename.statusIdle';
}

function buildSessionSummaryDebugReport(snapshot: SessionSummarySnapshot): string {
  const lines = [
    '# Session Summary Debug Report',
    `conversationId: ${snapshot.conversationId}`,
    `projectId: ${snapshot.projectId}`,
    `taskId: ${snapshot.taskId}`,
    `status: ${snapshot.status}`,
    `runtimeId: ${snapshot.runtimeId ?? '-'}`,
    `runtimeName: ${snapshot.runtimeName ?? '-'}`,
    `model: ${snapshot.model ?? '-'}`,
    `language: ${snapshot.language ?? '-'}`,
    `systemPromptEstimatedTokens: ${snapshot.systemPromptEstimatedTokens ?? '-'}`,
    `promptChars: ${snapshot.promptChars ?? '-'}`,
    `promptEstimatedTokens: ${snapshot.promptEstimatedTokens ?? '-'}`,
    `error: ${snapshot.error ?? '-'}`,
    `createdAt: ${snapshot.createdAt}`,
    `updatedAt: ${snapshot.updatedAt}`,
  ];

  if (snapshot.generatedSummary) {
    lines.push('', '## Generated Summary', snapshot.generatedSummary);
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

/**
 * Label cell shared by the info rows. `info` adds a hover-revealed Info icon
 * that opens a click popover explaining what the field means.
 */
function SessionInfoLabelCell({ label, info }: { label: string; info?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-0.5 text-foreground-passive">
      <span className="truncate" title={label}>
        {label}
      </span>
      {info ? (
        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                className="shrink-0 opacity-0 hover:text-foreground group-hover/info-row:opacity-100 data-popup-open:opacity-100"
                aria-label={label}
              >
                <Info className="size-3" aria-hidden="true" />
              </button>
            }
          />
          <PopoverContent
            side="bottom"
            align="start"
            className="w-60 p-2.5 text-xs leading-relaxed text-foreground-muted"
          >
            {info}
          </PopoverContent>
        </Popover>
      ) : null}
    </span>
  );
}

function SessionInfoValue({
  label,
  value,
  mono = false,
  copyable = false,
  info,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  copyable?: boolean;
  info?: string;
}) {
  const { t } = useTranslation();
  if (!value) return null;
  const copyValue = async () => {
    try {
      const result = await rpc.app.clipboardWriteText(value);
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
    <div className="group/info-row col-span-2 grid min-w-0 grid-cols-subgrid items-center gap-x-2 text-[11px] leading-tight">
      <SessionInfoLabelCell label={label} info={info} />
      <span className="flex min-w-0 items-center gap-1">
        <span
          className={cn('min-w-0 truncate text-foreground-muted', mono && 'font-mono')}
          title={value}
        >
          {value}
        </span>
        {copyable ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto size-4 shrink-0 text-foreground-passive opacity-0 hover:text-foreground group-hover/info-row:opacity-100"
            title={t('common.copy')}
            aria-label={t('common.copy')}
            onClick={() => void copyValue()}
          >
            <Copy className="size-3" aria-hidden="true" />
          </Button>
        ) : null}
      </span>
    </div>
  );
}

function SessionInfoTimeValue({
  label,
  value,
  info,
}: {
  label: string;
  value?: string | null;
  info?: string;
}) {
  if (!value) return null;
  return (
    <div className="group/info-row col-span-2 grid min-w-0 grid-cols-subgrid items-center gap-x-2 text-[11px] leading-tight">
      <SessionInfoLabelCell label={label} info={info} />
      <span className="min-w-0 truncate text-foreground-muted" title={value}>
        <RelativeTime value={value} />
      </span>
    </div>
  );
}

function SessionInfoDivider() {
  return <div className="col-span-2 my-0.5 h-px bg-border/70" />;
}
