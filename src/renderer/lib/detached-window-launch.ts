import { isAiLabWindowLaunch } from '@renderer/lib/ai-lab-window-launch-target';
import { isComparisonWindowLaunch } from '@renderer/lib/comparison-window-launch-target';
import { isStandaloneKanbanWindowLaunch } from '@renderer/lib/standalone-kanban-window-launch-target';
import { isTaskWindowLaunch } from '@renderer/lib/task-window-launch-target';

/**
 * True when this renderer is one of the detached windows (task, comparison, AI
 * Lab, agent board) rather than the full app shell. Detached windows skip the
 * boot screen, the app-tab strip, navigation restore and view-state writes, so
 * every one of those gates asks this single question instead of enumerating the
 * window kinds — a new kind would otherwise have to be added to each of them.
 */
export const isDetachedWindowLaunch =
  isTaskWindowLaunch ||
  isComparisonWindowLaunch ||
  isAiLabWindowLaunch ||
  isStandaloneKanbanWindowLaunch;

/** True when this renderer runs the full app shell (the main window or a duplicate). */
export const isPrimaryAppWindowLaunch = !isDetachedWindowLaunch;
