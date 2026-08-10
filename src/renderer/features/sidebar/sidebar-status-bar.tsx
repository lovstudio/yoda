import { SidebarAccountAnchor } from './sidebar-account-anchor';

export function SidebarStatusBar() {
  return (
    <footer
      data-yoda-surface="sidebar-status-bar"
      className="flex shrink-0 border-t border-border/45 bg-background-tertiary/65 px-1.5 py-1 text-[11px] text-foreground-tertiary-muted backdrop-blur-sm"
    >
      <SidebarAccountAnchor />
    </footer>
  );
}
