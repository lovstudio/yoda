import {
  parseStandaloneKanbanWindowTargetSearch,
  type StandaloneKanbanWindowTarget,
} from '@shared/standalone-kanban-window';

/**
 * The board cold-starts with its initial pane list encoded in the URL. Later
 * lists arrive over `standaloneKanbanPanesChangedChannel`, so this value is only
 * the first frame — read once at module load, like the other detached windows.
 */
const initialTarget: StandaloneKanbanWindowTarget | null =
  typeof window === 'undefined'
    ? null
    : parseStandaloneKanbanWindowTargetSearch(window.location.search);

/** True when this renderer was launched as the standalone agent board window. */
export const isStandaloneKanbanWindowLaunch = initialTarget !== null;

export function getStandaloneKanbanWindowLaunchTarget(): StandaloneKanbanWindowTarget | null {
  return initialTarget;
}
