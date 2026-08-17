import { Cloud, ExternalLink, ScrollText, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MaasGlobalBindingStatus } from '@shared/maas';
import { MaasGlobalSelector } from '@renderer/features/maas/components/MaasGlobalSelector';
import { DropdownMenuItem } from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';
import {
  WorkspaceBarCardHeader,
  WorkspaceBarCardMenu,
  WorkspaceBarCardSection,
} from './workspace-bar-card';

export function WorkspaceMaasPopover({
  binding,
  providerName,
  websiteUrl,
  onManage,
  onOpenWebsite,
  onOpenLogs,
}: {
  binding: MaasGlobalBindingStatus | undefined;
  /** Bound platform's display name, for the website jump's label. */
  providerName: string | null;
  /** Null hides the website jump; also shown as its tooltip. */
  websiteUrl: string | null;
  onManage: () => void;
  onOpenWebsite: () => void;
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
            <DropdownMenuItem onClick={onManage}>
              <SlidersHorizontal aria-hidden />
              {t('workspaceRuntime.maas.manageAccount')}
            </DropdownMenuItem>
            {/* The bound platform's own console. This entry owns the platform's
                identity, so jumps to it live here rather than beside its usage. */}
            {websiteUrl && providerName ? (
              <DropdownMenuItem onClick={onOpenWebsite} title={websiteUrl}>
                <ExternalLink aria-hidden />
                {t('workspaceRuntime.maas.openWebsite', { provider: providerName })}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={onOpenLogs}>
              <ScrollText aria-hidden />
              {t('workspaceRuntime.maas.openLogs')}
            </DropdownMenuItem>
          </WorkspaceBarCardMenu>
        }
      />

      <WorkspaceBarCardSection label={t('workspaceRuntime.maas.profile')}>
        <MaasGlobalSelector showSelectedStatus={false} />
      </WorkspaceBarCardSection>
    </>
  );
}
