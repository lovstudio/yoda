import type { ViewId, WrapParams } from '@renderer/app/view-registry';
import { paramsEqual } from '@renderer/lib/stores/navigation-history-store';

/**
 * Which params make up a view's page identity.
 *
 * Back/forward holds one entry per page the user perceives as distinct. A
 * view-id change always is one. An in-view param change only is one when it
 * moves a param listed here — a settings tab, a library section, the app a
 * section drilled into. Everything left out is presentation state that must not
 * create a back step: composer preselects, display names carried for chrome,
 * one-shot intents the view clears after consuming them.
 *
 * Only the in-view update path (`useParams().setParams`) consults this table.
 * `navigate()` is an explicit page change and always pushes.
 *
 * Every view is listed, so adding one forces this decision.
 */
export const PAGE_IDENTITY_PARAMS: {
  [K in ViewId]: readonly (keyof WrapParams<K> & string)[];
} = {
  // Index pages with no params — the view id is the whole identity.
  agentManager: [],
  agents: [],
  aiLab: [],
  automation: [],
  kanban: [],
  mcp: [],
  mobile: [],
  projectsOverview: [],
  roadmap: [],
  usage: [],

  // The composer. `projectId`/`runMode` preselect its controls and are cleared
  // once applied; neither changes the page.
  home: [],

  // Secondary navigation inside one surface: the section is the page, and an
  // opened app is a page below it. `createPrompt` is a one-shot open intent.
  library: ['section', 'appId'],
  marketplace: ['section', 'appId'],

  // One page per platform account.
  maas: ['platformId'],

  // 23 panes behind one tab picker, each its own page. `runtimeId` only scrolls
  // a runtime into focus within the pane it is already on.
  settings: ['tab'],

  // The catalog index; `focusSkillId` scrolls a row into view.
  skills: [],
  // Display names ride along for chrome only.
  skill: ['skillId'],
  skillCompare: ['baseSkillId', 'targetSkillId'],

  // Entity scopes. Every page move inside them goes through `navigate()` or
  // `appTabs`, never `setParams` — listing the params keeps the intent explicit
  // if that ever changes.
  project: ['projectId', 'view'],
  file: ['projectId', 'filePath'],

  // Task pages are recorded as `kind: 'tab'` history entries by TaskViewStore,
  // which follows the task's own tab manager. Pushing a view entry here too
  // would double-count every tab switch.
  task: [],
};

/** Whether moving a view's params from `prev` to `next` lands on another page. */
export function isPageIdentityChange<TId extends ViewId>(
  viewId: TId,
  prev: WrapParams<TId>,
  next: WrapParams<TId>
): boolean {
  const keys = PAGE_IDENTITY_PARAMS[viewId] as readonly string[];
  const prevRecord = prev as Record<string, unknown>;
  const nextRecord = next as Record<string, unknown>;
  return keys.some((key) => !paramsEqual(prevRecord[key], nextRecord[key]));
}
