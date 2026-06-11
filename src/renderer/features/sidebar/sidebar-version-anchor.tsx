import { ChevronsUpDown, Download } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useTranslation } from 'react-i18next';
import yodaIcon from '@/assets/images/yoda/icon-light.png';
import { PRODUCT_NAME } from '@shared/app-identity';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { appState, sidebarStore } from '@renderer/lib/stores/app-state';
import { cn } from '@renderer/utils/utils';

/**
 * Version anchor pinned to the very bottom of the left sidebar. Shows the
 * product name with the current version and toggles the secondary sidebar
 * navigation. When an update is available, a download affordance appears
 * that jumps to the general settings tab.
 */
export const SidebarVersionAnchor: React.FC = observer(function SidebarVersionAnchor() {
  const { t } = useTranslation();
  const { navigate } = useNavigate();

  const update = appState.update;
  const versionLabel = `V${update.currentVersion || '...'}`;
  const navHidden = sidebarStore.navSectionHidden;

  const handleToggleSidebarNav = React.useCallback(() => {
    sidebarStore.toggleNavSectionHidden();
  }, []);

  const handleOpenUpdate = React.useCallback(() => {
    navigate('settings', { tab: 'general' });
  }, [navigate]);

  return (
    <div className="flex items-center">
      <button
        type="button"
        onClick={handleToggleSidebarNav}
        className={cn(
          'group/version flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left outline-none transition-colors',
          'hover:bg-background-tertiary-1 focus-visible:bg-background-tertiary-1'
        )}
        aria-expanded={!navHidden}
        aria-label={navHidden ? t('sidebar.showNav') : t('sidebar.hideNav')}
        title={navHidden ? t('sidebar.showNav') : t('sidebar.hideNav')}
      >
        <img src={yodaIcon} alt={PRODUCT_NAME} className="size-5 shrink-0 rounded-sm" />
        <span className="truncate text-[13px] font-medium text-foreground-tertiary">
          {PRODUCT_NAME}
        </span>
        <span
          className={cn(
            'shrink-0 font-mono text-[10px] text-foreground-tertiary-passive',
            update.hasUpdate && 'text-accent'
          )}
        >
          {versionLabel}
        </span>
        <ChevronsUpDown className="ml-auto size-3.5 shrink-0 text-foreground-tertiary-passive transition-colors group-hover/version:text-foreground-tertiary" />
      </button>
      {update.hasUpdate && (
        <button
          type="button"
          onClick={handleOpenUpdate}
          aria-label={t('sidebar.update')}
          title={
            update.availableVersion
              ? `${t('sidebar.update')} V${update.availableVersion}`
              : t('sidebar.update')
          }
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-accent transition-colors hover:bg-background-tertiary-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Download className="size-4" />
        </button>
      )}
    </div>
  );
});
