import { Loader2, MessageSquare, Square } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { openTaskTarget } from '@renderer/app/open-task-target';
import { formatConversationTitleForDisplay } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { interruptTaskSessions } from '@renderer/features/tasks/interrupt-task-sessions';
import { registeredTaskData, type TaskStore } from '@renderer/features/tasks/stores/task';
import {
  taskSessionStatusSummary,
  type TaskSessionStatusItem,
} from '@renderer/features/tasks/stores/task-selectors';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { agentConfig } from '@renderer/utils/agentConfig';
import { log } from '@renderer/utils/logger';
import { cn } from '@renderer/utils/utils';
import { AgentStatusIndicator } from './agent-status-indicator';

type TaskSessionStatusControlProps = {
  task: TaskStore;
  className?: string;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left' | 'inline-start' | 'inline-end';
};

/**
 * Shared task-level entry point for every active or attention-worthy session.
 * The trigger keeps the compact status signal; the popover preserves the
 * individual sessions and their actions instead of collapsing them to one dot.
 */
export const TaskSessionStatusControl = observer(function TaskSessionStatusControl({
  task,
  className,
  align = 'end',
  side = 'bottom',
}: TaskSessionStatusControlProps) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const [open, setOpen] = useState(false);
  const [interruptingIds, setInterruptingIds] = useState<Set<string>>(() => new Set());
  const taskData = registeredTaskData(task);
  const summary = taskSessionStatusSummary(task);

  if (!taskData || !summary.primaryStatus) return null;

  const sessionTitle = (session: TaskSessionStatusItem, index: number) => {
    if (session.runtimeId && session.title) {
      return formatConversationTitleForDisplay(session.runtimeId, session.title).trim();
    }
    return session.title?.trim() || t('tasks.sessionStatus.unnamedSession', { index: index + 1 });
  };

  const handleOpenSession = (conversationId: string) => {
    setOpen(false);
    openTaskTarget(
      { projectId: taskData.projectId, taskId: taskData.id, conversationId },
      navigate
    );
  };

  const handleInterruptSession = (conversationId: string) => {
    setInterruptingIds((current) => new Set(current).add(conversationId));
    void rpc.conversations
      .interruptConversation(taskData.projectId, taskData.id, conversationId)
      .catch((error: unknown) => {
        log.warn('TaskSessionStatusControl: failed to interrupt conversation', {
          projectId: taskData.projectId,
          taskId: taskData.id,
          conversationId,
          error,
        });
      })
      .finally(() => {
        setInterruptingIds((current) => {
          const next = new Set(current);
          next.delete(conversationId);
          return next;
        });
      });
  };

  const triggerLabel = t('tasks.sessionStatus.manage', { count: summary.totalCount });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={triggerLabel}
            aria-expanded={open}
            className={cn(
              'flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-md px-0.5 transition-colors hover:bg-background-tertiary-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              className
            )}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <AgentStatusIndicator
              status={summary.primaryStatus}
              disableTooltip
              boxClassName="size-4"
            />
            {summary.totalCount > 1 ? (
              <span className="min-w-3 text-center font-mono text-[10px] leading-none text-foreground-muted tabular-nums">
                {summary.totalCount}
              </span>
            ) : null}
          </button>
        }
      />
      <PopoverContent
        align={align}
        side={side}
        sideOffset={6}
        className="w-80 gap-0 overflow-hidden p-0"
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">
              {t('tasks.sessionStatus.title')}
            </div>
            <div className="text-xs text-foreground-passive">
              {t('tasks.sessionStatus.summary', { count: summary.totalCount })}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 text-[10px] tabular-nums">
            {summary.attentionCount > 0 ? (
              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
                {t('tasks.sessionStatus.attentionCount', { count: summary.attentionCount })}
              </span>
            ) : null}
            {summary.workingCount > 0 ? (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">
                {t('tasks.sessionStatus.workingCount', { count: summary.workingCount })}
              </span>
            ) : null}
          </div>
        </div>

        <div className="max-h-72 overflow-y-auto p-1.5">
          {summary.sessions.map((session, index) => {
            const title = sessionTitle(session, index);
            const config = session.runtimeId ? agentConfig[session.runtimeId] : undefined;
            const interrupting = interruptingIds.has(session.conversationId);
            return (
              <div
                key={session.conversationId}
                className="group/session flex min-w-0 items-center gap-1 rounded-md hover:bg-background-2"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                  aria-label={t('tasks.sessionStatus.openSession', { title })}
                  onClick={() => handleOpenSession(session.conversationId)}
                >
                  <span className="flex size-5 shrink-0 items-center justify-center">
                    {config ? (
                      <AgentLogo
                        logo={config.logo}
                        alt={config.alt}
                        isSvg={config.isSvg}
                        invertInDark={config.invertInDark}
                        className="size-4"
                      />
                    ) : (
                      <MessageSquare className="size-4 text-foreground-passive" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{title}</span>
                    <span className="flex items-center gap-1.5 text-[11px] text-foreground-passive">
                      <span>{t(`agentStatus.${session.status}`)}</span>
                      {session.lastInteractedAt ? (
                        <>
                          <span aria-hidden>·</span>
                          <RelativeTime value={session.lastInteractedAt} compact />
                        </>
                      ) : null}
                    </span>
                  </span>
                  <AgentStatusIndicator
                    status={session.status}
                    disableTooltip
                    boxClassName="size-4"
                  />
                </button>
                {session.status === 'working' ? (
                  <button
                    type="button"
                    className="mr-1 flex size-7 shrink-0 items-center justify-center rounded text-foreground-passive opacity-60 outline-none transition-opacity hover:bg-background-3 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring group-hover/session:opacity-100 disabled:opacity-40"
                    aria-label={t('tasks.sessionStatus.interruptSession', { title })}
                    disabled={interrupting}
                    onClick={() => handleInterruptSession(session.conversationId)}
                  >
                    {interrupting ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Square className="size-3 fill-current" />
                    )}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        {summary.workingCount > 1 ? (
          <div className="border-t border-border p-1.5">
            <button
              type="button"
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md text-xs text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={() => interruptTaskSessions(taskData.projectId, taskData.id)}
            >
              <Square className="size-3 fill-current" />
              {t('tasks.sessionStatus.interruptAll', { count: summary.workingCount })}
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
});
