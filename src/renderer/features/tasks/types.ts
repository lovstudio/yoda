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
  | 'overview'
  // Harness blinds (the agent runtime view), migrated from the retired
  // harness tab into the same accordion as first-class sections.
  | 'memory'
  | 'tools'
  | 'mcp-servers'
  | 'skills'
  | 'agents-available'
  | 'hooks';

/**
 * Orderable/hideable units of the Session panel accordion, in default order.
 * Units and sections are the same set — every blind is individually
 * manageable, including the harness ones.
 */
export const SESSION_PANEL_UNITS = [
  'basic',
  'conversation',
  'transcript',
  'tasks',
  'memory',
  'tools',
  'mcp-servers',
  'skills',
  'agents-available',
  'hooks',
  'overview',
] as const;

export type SessionPanelUnit = (typeof SESSION_PANEL_UNITS)[number];

export function isSessionPanelUnit(value: unknown): value is SessionPanelUnit {
  return SESSION_PANEL_UNITS.includes(value as SessionPanelUnit);
}

/** i18n label key for a Session panel unit (matches the blind titles). */
export function sessionPanelUnitLabelKey(unit: SessionPanelUnit): string {
  switch (unit) {
    case 'basic':
      return 'tasks.sessionPanel.basic';
    case 'conversation':
      return 'tasks.sessionPanel.conversation';
    case 'transcript':
      return 'tasks.sessionPanel.transcript';
    case 'tasks':
      return 'tasks.sessionPanel.tasks';
    case 'memory':
      return 'tasks.panel.memory';
    case 'tools':
      return 'tasks.panel.tools';
    case 'mcp-servers':
      return 'tasks.panel.mcpServers';
    case 'skills':
      return 'tasks.panel.skills';
    case 'agents-available':
      return 'tasks.panel.agentsAvailable';
    case 'hooks':
      return 'tasks.sessionPanel.hooks';
    case 'overview':
      return 'tasks.sessionPanel.overview';
  }
}

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
