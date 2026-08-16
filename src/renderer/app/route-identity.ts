import type { ViewId, WrapParams } from '@renderer/app/view-registry';
import { paramsEqual } from '@renderer/lib/stores/navigation-history-store';

/**
 * The pane a view opens on when its identity param is absent.
 *
 * These live here rather than in the views because history has to agree with the
 * view about what page an entry denotes: an absent param and its default are the
 * same page, so recording them as different entries puts one page in the stack
 * twice. The views read these constants for their own defaults, so there is one
 * literal per default.
 */
export const DEFAULT_SETTINGS_TAB = 'general' as const;
export const DEFAULT_LIBRARY_SECTION = 'prompts' as const;
export const DEFAULT_MARKETPLACE_SECTION = 'extensions' as const;

/**
 * Which params make up a view's page identity, and what each one defaults to.
 *
 * Back/forward holds one entry per page the user perceives as distinct. A
 * view-id change always is one. An in-view param change only is one when it
 * moves a param listed here — a settings tab, a library section, the app a
 * section drilled into. Everything left out is presentation state that must not
 * create a back step: composer preselects, display names carried for chrome,
 * one-shot intents the view clears after consuming them.
 *
 * A listed param maps to the value the view falls back to, or `undefined` when
 * absent is its own page (no app opened, no platform selected). Both the in-view
 * update path (`useParams().setParams`) and the recorded history entry resolve
 * params through this table, so `{}` and `{ tab: 'general' }` are one page.
 *
 * Every view is listed, so adding one forces this decision.
 */
export const PAGE_IDENTITY_PARAMS: {
  [K in ViewId]: Readonly<Partial<WrapParams<K>>>;
} = {
  // Index pages with no params — the view id is the whole identity.
  agentManager: {},
  agents: {},
  aiLab: {},
  automation: {},
  kanban: {},
  mcp: {},
  mobile: {},
  projectsOverview: {},
  roadmap: {},
  usage: {},

  // The composer. `projectId`/`runMode` preselect its controls and are cleared
  // once applied; neither changes the page.
  home: {},

  // Secondary navigation inside one surface: the section is the page, and an
  // opened app is a page below it. `createPrompt` is a one-shot open intent.
  library: { section: DEFAULT_LIBRARY_SECTION, appId: undefined },
  marketplace: { section: DEFAULT_MARKETPLACE_SECTION, appId: undefined },

  // 23 panes behind one tab picker, each its own page. `runtimeId` and
  // `maasPlatformId` only scroll a runtime or Profile into focus within the pane
  // it is already on.
  settings: { tab: DEFAULT_SETTINGS_TAB },

  // The catalog index; `focusSkillId` scrolls a row into view.
  skills: {},
  // Display names ride along for chrome only.
  skill: { skillId: undefined },
  skillCompare: { baseSkillId: undefined, targetSkillId: undefined },

  // Entity scopes. Every page move inside them goes through `navigate()` or
  // `appTabs`, which always pass complete params — listing them keeps the intent
  // explicit if that ever changes.
  project: { projectId: undefined, view: undefined },
  file: { projectId: undefined, filePath: undefined },

  // Task pages are recorded as `kind: 'tab'` history entries by TaskViewStore,
  // which follows the task's own tab manager. Pushing a view entry here too
  // would put the same page in the stack twice.
  task: {},
};

function identityValues<TId extends ViewId>(
  viewId: TId,
  params: WrapParams<TId>
): Record<string, unknown> {
  const defaults = PAGE_IDENTITY_PARAMS[viewId] as Record<string, unknown>;
  const source = params as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(defaults).map((key) => [key, source[key] ?? defaults[key]])
  );
}

/** Whether moving a view's params from `prev` to `next` lands on another page. */
export function isPageIdentityChange<TId extends ViewId>(
  viewId: TId,
  prev: WrapParams<TId>,
  next: WrapParams<TId>
): boolean {
  const prevValues = identityValues(viewId, prev);
  const nextValues = identityValues(viewId, next);
  return Object.keys(prevValues).some((key) => !paramsEqual(prevValues[key], nextValues[key]));
}

/**
 * Fills in defaulted identity params so one page has one representation in
 * history. Without this, opening Settings records `{}` and then selecting the
 * pane it already shows records `{ tab: 'general' }` — two entries for the pane
 * the user is looking at, so Back and Forward both appear to do nothing.
 */
export function canonicalPageParams<TId extends ViewId>(
  viewId: TId,
  params: WrapParams<TId>
): WrapParams<TId> {
  const defaults = PAGE_IDENTITY_PARAMS[viewId] as Record<string, unknown>;
  const canonical = { ...(params as Record<string, unknown>) };
  for (const [key, fallback] of Object.entries(defaults)) {
    if (canonical[key] === undefined && fallback !== undefined) canonical[key] = fallback;
  }
  return canonical as WrapParams<TId>;
}
