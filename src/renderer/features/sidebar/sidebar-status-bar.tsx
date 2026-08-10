import { SidebarAccountAnchor } from './sidebar-account-anchor';

export function SidebarStatusBar() {
  return (
    <footer
      data-yoda-surface="sidebar-status-bar"
      className="flex shrink-0 border-t border-border/70 bg-background-tertiary px-2 py-2 text-[11px] text-foreground-tertiary-muted"
    >
      <SidebarAccountAnchor />
    </footer>
  );
}
