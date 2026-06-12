import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getRuntime } from '@shared/runtime-registry';
import { rpc } from '@renderer/lib/ipc';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Spinner } from '@renderer/lib/ui/spinner';
import type { BoardCard } from './KanbanCard';

/**
 * Hover preview for a kanban card: latest session summary (read-only peek —
 * never triggers generation), diff totals, and per-session agent state.
 */
export function TaskHoverPreview({ card }: { card: BoardCard }) {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['kanbanTaskPreview', card.projectId, card.task.id],
    queryFn: () => rpc.tasks.getTaskPreview(card.projectId, card.task.id),
    staleTime: 15_000,
  });

  return (
    <div className="flex w-80 flex-col">
      <div className="border-b border-border px-3 py-2">
        <div className="truncate text-sm font-medium text-foreground">{card.task.name}</div>
        <div className="flex items-center gap-2 text-xs text-foreground-tertiary-passive">
          <span className="truncate">{card.projectName}</span>
          {card.task.taskBranch && (
            <span className="truncate font-mono text-foreground-tertiary-muted">
              {card.task.taskBranch}
            </span>
          )}
        </div>
      </div>

      <div className="max-h-64 overflow-y-auto px-3 py-2">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        ) : data?.summary ? (
          <MarkdownRenderer content={data.summary} variant="compact" className="text-xs" />
        ) : (
          <div className="py-3 text-center text-xs text-foreground-tertiary-passive">
            {t('kanban.preview.noSummary')}
          </div>
        )}
      </div>

      {data && (
        <div className="flex flex-col gap-1 border-t border-border px-3 py-2 text-xs">
          <div className="flex items-center gap-1">
            <span className="text-foreground-diff-added">+{data.diff.additions}</span>
            <span className="text-foreground-diff-deleted">-{data.diff.deletions}</span>
            {data.lastInteractedAt && (
              <RelativeTime
                value={data.lastInteractedAt}
                ago
                className="ml-auto text-foreground-tertiary-passive"
              />
            )}
          </div>
          {data.sessions.map((session) => (
            <div key={session.id} className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-foreground-tertiary">
                {getRuntime(session.runtimeId)?.name ?? session.runtimeId}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground-tertiary-passive">
                {session.title ?? ''}
              </span>
              {session.status && session.status !== 'idle' && (
                <span className="shrink-0 text-foreground-tertiary-passive">
                  {t(`agentStatus.${session.status}`)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
