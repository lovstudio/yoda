import { Loader2, Maximize2, MessageSquareText, MoreHorizontal, RotateCcw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClaudeSessionPrompt, Conversation } from '@shared/conversations';
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
import { buildPromptPreviewItems } from '@renderer/features/tasks/session-prompts-preview';
import { getTaskStore, taskDisplayName } from '@renderer/features/tasks/stores/task-selectors';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { MicroLabel } from '@renderer/lib/ui/label';
import { cn } from '@renderer/utils/utils';

export const SessionInfoPanel = observer(function SessionInfoPanel({
  active,
}: {
  active: boolean;
}) {
  const { t } = useTranslation();
  const { projectId, taskId } = useTaskViewContext();
  const provisionedTask = useProvisionedTask();
  const taskStore = getTaskStore(projectId, taskId);
  const conversation = getTaskMenuConversation(provisionedTask);
  const [isLoading, setIsLoading] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [resolvedFields, setResolvedFields] = useState<TaskMenuSessionFields | undefined>();
  const [prompts, setPrompts] = useState<ClaudeSessionPrompt[] | undefined>();
  const [isPromptsLoading, setIsPromptsLoading] = useState(false);
  const showSessionPrompts = useShowModal('sessionPromptsModal');

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
    setPrompts(undefined);
  }, [conversation?.id]);

  useEffect(() => {
    if (!active || !conversation) return;
    let cancelled = false;
    setIsLoading(true);
    setIsPromptsLoading(true);
    void (async () => {
      const info = await resolveTaskMenuSessionFields(conversation, provisionedTask.path);
      if (!cancelled) setResolvedFields(info);
      const nextPrompts = await resolveSessionPrompts(
        conversation,
        provisionedTask.path,
        info.sessionId
      );
      if (!cancelled) setPrompts(nextPrompts);
    })()
      .catch(() => {
        if (!cancelled) setPrompts([]);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
          setIsPromptsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [active, conversation, provisionedTask.path]);

  const restartSession = async () => {
    if (!conversation || isRestarting) return;
    setIsRestarting(true);
    try {
      await provisionedTask.conversations.restartConversation(conversation.id);
      const next = await resolveTaskMenuSessionFields(conversation, provisionedTask.path);
      setResolvedFields(next);
      setIsPromptsLoading(true);
      setPrompts(await resolveSessionPrompts(conversation, provisionedTask.path, next.sessionId));
    } finally {
      setIsPromptsLoading(false);
      setIsRestarting(false);
    }
  };

  const openPromptsModal = () => {
    if (!conversation) return;
    showSessionPrompts({
      prompts: prompts ?? [],
      sessionTitle: fields?.sessionTitle ?? conversation.title,
    });
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

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-border/70 pl-3 pr-1.5">
        <MicroLabel className="truncate text-foreground-passive">
          {t('tasks.sessionInfo.title')}
        </MicroLabel>
        {isLoading ? <Loader2 className="size-3.5 animate-spin text-foreground-passive" /> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!conversation || !fields ? (
          <EmptyState
            label={t('tasks.sessionInfo.noSession')}
            description={t('tasks.sessionInfo.noSessionDescription')}
          />
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            <section className="grid gap-1.5 rounded-md border border-border bg-background-1/40 p-2">
              <SessionInfoValue label={t('tasks.context.taskInfo.task')} value={taskName} />
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

            <SessionPromptsPreview
              prompts={prompts ?? []}
              isLoading={isPromptsLoading && prompts === undefined}
              onOpenAll={openPromptsModal}
            />

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full justify-center"
              disabled={isRestarting}
              onClick={restartSession}
            >
              {isRestarting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RotateCcw className="size-3.5" />
              )}
              {t('tasks.context.restartSession')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
});

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
    <section className="grid gap-2 rounded-md border border-border bg-background-1/40 p-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <MessageSquareText className="size-3.5 shrink-0 text-foreground-passive" />
          <MicroLabel className="truncate text-foreground-passive">
            {t('tasks.panel.sessionPrompts')}
          </MicroLabel>
          {hasPrompts ? (
            <span className="shrink-0 font-mono text-[10px] text-foreground-passive">
              {t('tasks.sessionInfo.promptCount', { count: prompts.length })}
            </span>
          ) : null}
        </div>
        {hasPrompts ? (
          <Button type="button" variant="ghost" size="xs" onClick={onOpenAll}>
            <Maximize2 className="size-3" />
            {t('tasks.sessionInfo.viewAllPrompts')}
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-1.5 rounded-sm border border-dashed border-border/70 px-2 py-1.5 text-xs text-foreground-passive">
          <Loader2 className="size-3 animate-spin" />
          {t('common.loading')}
        </div>
      ) : !hasPrompts ? (
        <div className="rounded-sm border border-dashed border-border/70 px-2 py-1.5 text-xs text-foreground-passive">
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
    </section>
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
}: {
  label: string;
  value?: string;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] gap-2 text-xs">
      <span className="text-foreground-passive">{label}</span>
      <span
        className={cn('min-w-0 truncate text-foreground-muted', mono && 'font-mono')}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function SessionInfoDivider() {
  return <div className="my-0.5 h-px bg-border/70" />;
}
