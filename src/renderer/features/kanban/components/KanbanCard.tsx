import { useDraggable } from '@dnd-kit/core';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import type { Task } from '@shared/tasks';
import { TaskSessionStatusControl } from '@renderer/features/tasks/components/task-session-status-control';
import type { TaskStore } from '@renderer/features/tasks/stores/task';
import { taskSessionStatusSummary } from '@renderer/features/tasks/stores/task-selectors';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';
import { TaskHoverPreview } from './TaskHoverPreview';

export type BoardCard = {
  projectId: string;
  projectName: string;
  task: Task;
  taskStore: TaskStore;
};

// The browser can fire a click on the drop target right after a drag —
// without this guard, finishing a drag would also open the task.
let suppressClicksUntil = 0;
export function suppressCardClicks(ms = 300): void {
  suppressClicksUntil = Date.now() + ms;
}

export const KanbanCard = observer(function KanbanCard({
  card,
  dragActive,
}: {
  card: BoardCard;
  dragActive: boolean;
}) {
  const { navigate } = useNavigate();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${card.projectId}::${card.task.id}`,
    data: { card },
  });
  const [previewOpen, setPreviewOpen] = useState(false);

  // Any in-flight drag kills the preview — a popover chasing a moving card is noise.
  useEffect(() => {
    if (dragActive && previewOpen) setPreviewOpen(false);
  }, [dragActive, previewOpen]);

  return (
    <Popover open={previewOpen} onOpenChange={(open) => setPreviewOpen(open && !dragActive)}>
      <PopoverTrigger
        openOnHover
        nativeButton={false}
        delay={500}
        render={
          <div
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            onClick={() => {
              if (Date.now() < suppressClicksUntil) return;
              navigate('task', { projectId: card.projectId, taskId: card.task.id });
            }}
            className={cn('cursor-grab', isDragging && 'opacity-40')}
          >
            <KanbanCardContent card={card} />
          </div>
        }
      />
      <PopoverContent side="right" align="start" className="w-80 gap-0 overflow-hidden p-0">
        <TaskHoverPreview card={card} />
      </PopoverContent>
    </Popover>
  );
});

export const KanbanCardContent = observer(function KanbanCardContent({
  card,
  dragging = false,
}: {
  card: BoardCard;
  dragging?: boolean;
}) {
  const sessionStatus = taskSessionStatusSummary(card.taskStore);

  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-md border border-border bg-background p-2.5 transition-colors hover:border-border-focused',
        dragging && 'shadow-lg'
      )}
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{card.task.name}</span>
        {sessionStatus.primaryStatus && (
          <span className="shrink-0">
            <TaskSessionStatusControl task={card.taskStore} side="right" />
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs text-foreground-tertiary-passive">
        <span className="truncate">{card.projectName}</span>
        {card.task.taskBranch && (
          <span className="truncate font-mono text-foreground-tertiary-muted">
            {card.task.taskBranch}
          </span>
        )}
      </div>
    </div>
  );
});
