import { ArrowDown, ArrowUp, ListRestart, MoreHorizontal } from 'lucide-react';
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

export const PriorityOrderModal = observer(function PriorityOrderModal({
  onClose,
}: BaseModalProps<void>) {
  const { t } = useTranslation();
  const movableGroups: SidebarTaskPriorityGroup[] = sidebarStore.taskPriorityOrder.filter(
    (group) => group !== 'archived'
  );

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
          {sidebarStore.taskPriorityOrder.map((group, orderIndex) => {
            const movableIndex = movableGroups.indexOf(group);
            const archived = group === 'archived';
            return (
              <div
                key={group}
                className="flex h-10 items-center gap-3 border-t border-border/50 px-3 text-xs first:border-t-0"
              >
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-background-tertiary-1 font-mono text-[10px] text-foreground-passive">
                  {orderIndex + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {t(`sidebar.priorityGroups.${group}`)}
                </span>
                {archived ? (
                  <span className="text-[11px] text-foreground-passive">
                    {t('sidebar.priorityArchivedLink')}
                  </span>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-foreground-muted"
                          aria-label={t('sidebar.priorityReorder', {
                            group: t(`sidebar.priorityGroups.${group}`),
                          })}
                        />
                      }
                    >
                      <MoreHorizontal className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-32">
                      <DropdownMenuItem
                        disabled={movableIndex <= 0}
                        onClick={() => sidebarStore.moveTaskPriorityGroup(group, -1)}
                      >
                        <ArrowUp />
                        {t('sidebar.priorityMoveUp')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={movableIndex < 0 || movableIndex >= movableGroups.length - 1}
                        onClick={() => sidebarStore.moveTaskPriorityGroup(group, 1)}
                      >
                        <ArrowDown />
                        {t('sidebar.priorityMoveDown')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            );
          })}
        </div>
      </DialogContentArea>
      <DialogFooter>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogFooter>
    </>
  );
});
