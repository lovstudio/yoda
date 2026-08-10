import { Settings, Smartphone, type LucideIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import type { ViewId } from '@renderer/app/view-registry';
import {
  isCurrentView,
  useNavigate,
  useWorkspaceSlots,
} from '@renderer/lib/layout/navigation-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { cn } from '@renderer/utils/utils';
import { GlobalSidePaneTarget } from './global-side-pane-target';
import { SidebarAccountAnchor } from './sidebar-account-anchor';

export const SidebarStatusBar = observer(function SidebarStatusBar() {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();
  const quickNavItems: Array<{
    viewId: Extract<ViewId, 'mobile' | 'settings'>;
    icon: LucideIcon;
    label: string;
  }> = [
    { viewId: 'mobile', icon: Smartphone, label: t('sidebar.mobile') },
    { viewId: 'settings', icon: Settings, label: t('sidebar.settings') },
  ];

  return (
    <footer
      data-yoda-surface="sidebar-status-bar"
      className="flex shrink-0 items-center justify-between gap-2 border-t border-border/70 bg-background-tertiary px-2 py-2 text-[11px] text-foreground-tertiary-muted"
    >
      <div className="min-w-0 flex-1">
        <SidebarAccountAnchor />
      </div>
      <div
        role="toolbar"
        aria-label={t('workspaceStatus.quickAccess')}
        className="flex shrink-0 items-center gap-0.5"
      >
        {quickNavItems.map(({ viewId, icon: Icon, label }) => (
          <GlobalSidePaneTarget key={viewId} viewId={viewId} tooltipSide="top" tooltipLabel={label}>
            <button
              type="button"
              onClick={(event) =>
                event.altKey ? appState.sidePane.toggleView(viewId, {}) : navigate(viewId)
              }
              aria-label={label}
              className={cn(
                'flex size-6 items-center justify-center rounded-md text-foreground-tertiary-passive transition-colors hover:bg-background-tertiary-1 hover:text-foreground-tertiary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border',
                isCurrentView(currentView, viewId) &&
                  'bg-background-tertiary-1 text-foreground-tertiary'
              )}
            >
              <Icon className="size-3.5" />
            </button>
          </GlobalSidePaneTarget>
        ))}
      </div>
    </footer>
  );
});
