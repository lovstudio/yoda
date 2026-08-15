import { Cloud, ScrollText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MaasGlobalBindingStatus, MaasPlatformId } from '@shared/maas';
import { MaasGlobalSelector } from '@renderer/features/maas/components/MaasGlobalSelector';
import { Button } from '@renderer/lib/ui/button';
import { DropdownMenuItem } from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';
import {
  WorkspaceBarCardFooter,
  WorkspaceBarCardHeader,
  WorkspaceBarCardMenu,
  WorkspaceBarCardSection,
} from './workspace-bar-card';

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
    <>
      <WorkspaceBarCardHeader
        icon={Cloud}
        title={t('workspaceRuntime.maas.title')}
        titleBadge={
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
        }
        description={t('workspaceRuntime.maas.description')}
        actions={
          <WorkspaceBarCardMenu>
            <DropdownMenuItem onClick={onOpenLogs}>
              <ScrollText aria-hidden />
              {t('workspaceRuntime.maas.openLogs')}
            </DropdownMenuItem>
          </WorkspaceBarCardMenu>
        }
      />

      <WorkspaceBarCardSection label={t('workspaceRuntime.maas.profile')}>
        <MaasGlobalSelector showSelectedStatus={false} onManagePlatform={onManagePlatform} />
      </WorkspaceBarCardSection>

      <WorkspaceBarCardFooter>
        <Button type="button" size="sm" variant="outline" className="w-full" onClick={onManage}>
          {t('workspaceRuntime.maas.manageAccount')}
        </Button>
      </WorkspaceBarCardFooter>
    </>
  );
}
