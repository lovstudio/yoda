import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { ArrowDown, ArrowUp, GripVertical, ListRestart, MoreHorizontal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import type { SidebarTaskPriorityGroup } from '@shared/view-state';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';

export const PriorityOrderModal = observer(function PriorityOrderModal({
  onClose,
}: BaseModalProps<void>) {
  const { t } = useTranslation();
  const movableGroups: SidebarTaskPriorityGroup[] = sidebarStore.taskPriorityOrder.filter(
    (group) => group !== 'archived'
  );
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('sidebar.priorityOrder')}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="gap-4">
        <DialogDescription>{t('sidebar.priorityOrderDescription')}</DialogDescription>
        <div className="overflow-hidden rounded-lg border border-border/80 bg-background">
          <div className="flex h-10 items-center justify-between border-b border-border/70 px-3">
            <span className="text-xs font-medium text-foreground-muted">
              {t('sidebar.priorityOrderGroups')}
            </span>
            <Button
              variant="ghost"
              size="xs"
              className="h-7 px-2 text-foreground-muted"
              onClick={() => sidebarStore.resetTaskPriorityOrder()}
            >
              <ListRestart className="size-3.5" />
              {t('sidebar.priorityReset')}
            </Button>
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={({ active, over }) => {
              if (!over || active.id === over.id) return;
              const from = movableGroups.indexOf(active.id as SidebarTaskPriorityGroup);
              const to = movableGroups.indexOf(over.id as SidebarTaskPriorityGroup);
              if (from < 0 || to < 0) return;
              sidebarStore.setTaskPriorityOrder(arrayMove(movableGroups, from, to));
            }}
          >
            <SortableContext items={movableGroups} strategy={verticalListSortingStrategy}>
              {movableGroups.map((group, orderIndex) => (
                <PriorityOrderRow
                  key={group}
                  group={group}
                  orderIndex={orderIndex}
                  movableCount={movableGroups.length}
                />
              ))}
            </SortableContext>
          </DndContext>
          {sidebarStore.taskPriorityOrder.includes('archived') && (
            <div className="flex h-10 items-center gap-3 border-t border-border/50 px-3 text-xs">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-background-tertiary-1 font-mono text-[10px] text-foreground-passive">
                {sidebarStore.taskPriorityOrder.length}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {t('sidebar.priorityGroups.archived')}
              </span>
              <span className="text-[11px] text-foreground-passive">
                {t('sidebar.priorityArchivedLink')}
              </span>
            </div>
          )}
        </div>
      </DialogContentArea>
      <DialogFooter>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogFooter>
    </>
  );
});

/**
 * One rankable group. The drag handle is the primary gesture; the menu keeps the
 * same two moves reachable without a pointer drag.
 */
const PriorityOrderRow = observer(function PriorityOrderRow({
  group,
  orderIndex,
  movableCount,
}: {
  group: SidebarTaskPriorityGroup;
  orderIndex: number;
  movableCount: number;
}) {
  const { t } = useTranslation();
  const { listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: group });
  const label = t(`sidebar.priorityGroups.${group}`);

  return (
    <div
      ref={setNodeRef}
      style={{
        // Vertical only: the ranking has one axis.
        transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined,
        transition,
      }}
      className={cn(
        'relative flex h-10 items-center gap-2 border-t border-border/50 bg-background px-3 text-xs first:border-t-0',
        isDragging && 'z-10 shadow-sm'
      )}
    >
      <span
        {...listeners}
        ref={setActivatorNodeRef}
        aria-label={t('sidebar.priorityDragHandle', { group: label })}
        className="flex size-4 shrink-0 cursor-grab items-center justify-center text-foreground-passive hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="size-3.5" />
      </span>
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-background-tertiary-1 font-mono text-[10px] text-foreground-passive">
        {orderIndex + 1}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-foreground-muted"
              aria-label={t('sidebar.priorityReorder', { group: label })}
            />
          }
        >
          <MoreHorizontal className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-32">
          <DropdownMenuItem
            disabled={orderIndex <= 0}
            onClick={() => sidebarStore.moveTaskPriorityGroup(group, -1)}
          >
            <ArrowUp />
            {t('sidebar.priorityMoveUp')}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={orderIndex >= movableCount - 1}
            onClick={() => sidebarStore.moveTaskPriorityGroup(group, 1)}
          >
            <ArrowDown />
            {t('sidebar.priorityMoveDown')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});
