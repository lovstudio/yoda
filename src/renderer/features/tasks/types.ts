export type SidebarTab =
  | 'session'
  | 'task'
  | 'conversations'
  | 'changes'
  | 'files'
  | 'context'
  | 'hooks'
  | 'rename';

/**
 * The blinds (百叶窗 sections) of the merged Session panel. Several legacy
 * `SidebarTab` values now route into a single "session" titlebar toggle and
 * deep-link to one of these accordion sections.
 */
export type SessionPanelSection =
  | 'basic'
  | 'conversation'
  | 'transcript'
  | 'tasks'
  | 'summary-global'
  // Harness blinds (the agent runtime view), folded into the same accordion.
  | 'llm-context'
  | 'memory'
  | 'tools'
  | 'mcp-servers'
  | 'skills'
  | 'agents-available'
  | 'hooks';

/**
 * Legacy session-family tabs that have been folded into the single Session
 * toggle. Activating the Session toggle (or deep-linking to any of these)
 * routes to the merged Session panel and expands the matching blind.
 */
export const SESSION_FAMILY_TABS: readonly SidebarTab[] = [
  'session',
  'conversations',
  'task',
  'rename',
  'context',
  'hooks',
];

export function isSessionFamilyTab(tab: SidebarTab): boolean {
  return SESSION_FAMILY_TABS.includes(tab);
}

/**
 * The feature cards the task sidebar exposes after merging the session-family
 * tabs. Each card is an independently addable/closable chip in the sidebar
 * strip (extensible later).
 */
export type SidebarTabGroup = 'session' | 'changes' | 'files';

export const SIDEBAR_TAB_GROUPS: readonly SidebarTabGroup[] = ['session', 'changes', 'files'];

export function isSidebarTabGroup(value: unknown): value is SidebarTabGroup {
  return SIDEBAR_TAB_GROUPS.includes(value as SidebarTabGroup);
}

/** Which sidebar tab group a (legacy) sidebar tab belongs to. */
export function sidebarGroupForTab(tab: SidebarTab): SidebarTabGroup {
  if (tab === 'changes' || tab === 'files') return tab;
  return 'session';
}

/** The canonical sidebar tab a tab group activates. */
export function sidebarTabForGroup(group: SidebarTabGroup): SidebarTab {
  return group;
}

/** Maps a session-family tab to the blind it should expand, if any. */
export function sessionSectionForTab(tab: SidebarTab): SessionPanelSection | null {
  switch (tab) {
    case 'session':
    case 'rename':
      return 'basic';
    case 'task':
      return 'tasks';
    case 'conversations':
      return 'conversation';
    case 'context':
      return 'memory';
    case 'hooks':
      return 'hooks';
    default:
      return null;
  }
}

export type FileRendererData =
  | { kind: 'text' }
  | { kind: 'markdown' }
  | { kind: 'markdown-source' }
  | { kind: 'svg' }
  | { kind: 'svg-source' }
  | { kind: 'image' }
  | { kind: 'pdf' }
  | { kind: 'binary' }
  | { kind: 'too-large' }
  | { kind: 'file-error' };
