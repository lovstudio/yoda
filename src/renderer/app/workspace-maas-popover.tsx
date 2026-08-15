import { Cloud, Ellipsis, ScrollText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MaasGlobalBindingStatus, MaasPlatformId } from '@shared/maas';
import { MaasGlobalSelector } from '@renderer/features/maas/components/MaasGlobalSelector';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';

export function WorkspaceMaasPopover({
  binding,
  onManage,
  onManagePlatform,
  onOpenLogs,
}: {
  binding: MaasGlobalBindingStatus | undefined;
  onManage: () => void;
  onManagePlatform: (platformId: MaasPlatformId) => void;
  onOpenLogs: () => void;
}) {
  const { t } = useTranslation();
  const statusKey = binding?.effective
    ? 'workspaceRuntime.maas.effective'
    : binding?.enabled
      ? 'workspaceRuntime.maas.needsAttention'
      : 'workspaceRuntime.maas.disabled';

  return (
    <div className="p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/55 bg-background-2 text-foreground shadow-xs">
          <Cloud aria-hidden className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="truncate text-sm font-medium">{t('workspaceRuntime.maas.title')}</div>
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                binding?.effective
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : binding?.enabled
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'bg-background-2 text-foreground-muted'
              )}
            >
              {t(statusKey)}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] leading-4 text-foreground-passive">
            {t('workspaceRuntime.maas.description')}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 text-[11px] font-medium text-foreground-muted">
          {t('workspaceRuntime.maas.profile')}
        </div>
        <MaasGlobalSelector showSelectedStatus={false} onManagePlatform={onManagePlatform} />
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button type="button" className="min-w-0 flex-1" onClick={onManage}>
          {t('workspaceRuntime.maas.manageAccount')}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                title={t('common.more')}
                aria-label={t('common.more')}
              />
            }
          >
            <Ellipsis aria-hidden className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={onOpenLogs}>
              <ScrollText aria-hidden className="size-4" />
              {t('workspaceRuntime.maas.openLogs')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
