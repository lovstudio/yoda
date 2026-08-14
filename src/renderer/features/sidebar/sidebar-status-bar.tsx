import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { SidebarAccountAnchor } from './sidebar-account-anchor';
import { SidebarHelpMenu } from './sidebar-help-menu';

export function SidebarStatusBar() {
  const { value: interfaceSettings } = useAppSettingsKey('interface');
  const primary = interfaceSettings?.sidebarStatusBarPrimary ?? 'product';

  return (
    <footer
      data-yoda-surface="sidebar-status-bar"
      data-sidebar-status-primary={primary}
      className="flex shrink-0 items-center gap-1 border-t border-border/45 bg-background-tertiary/65 px-1.5 py-1 text-[11px] text-foreground-tertiary-muted backdrop-blur-sm"
    >
      {primary === 'account' ? (
        <>
          <SidebarAccountAnchor />
          <SidebarHelpMenu />
        </>
      ) : (
        <>
          <SidebarHelpMenu showProductInfo />
          <SidebarAccountAnchor compact />
        </>
      )}
    </footer>
  );
}
