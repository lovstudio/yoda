import { comparer, observable, reaction } from 'mobx';
import { standaloneKanbanWindowStateChannel } from '@shared/events/appEvents';
import type { StandaloneKanbanWindowTarget } from '@shared/standalone-kanban-window';
import { events, rpc } from '@renderer/lib/ipc';
import { appState } from '@renderer/lib/stores/app-state';

/**
 * Bridge between the main window's sidebar store (which owns the kanban ordering)
 * and the standalone agent board window. When the board is open, this reaction
 * pushes the ranked pane list to it whenever the ordering changes.
 *
 * The board itself cannot compute the kanban ranking — `priorityGroupedRows()`
 * requires `project.mountedProject`, so detached windows see only the projects
 * they explicitly mount. The main window resolves the full ranking and publishes
 * it, keeping the board window lightweight like the comparison window.
 */
export function startStandaloneKanbanBridge(): () => void {
  // Observable so opening the board re-runs the reaction immediately, instead of
  // waiting for the next ordering change to notice the window exists.
  const isOpen = observable.box(false);

  const openDisposer = events.on(standaloneKanbanWindowStateChannel, ({ open }) => {
    isOpen.set(open);
  });

  void rpc.app.isStandaloneKanbanWindowOpen().then((open) => {
    isOpen.set(open);
  });

  const reactionDisposer = reaction(
    (): StandaloneKanbanWindowTarget => ({
      panes: isOpen.get() ? appState.sidebar.standaloneKanbanPanes : [],
      maxPanes: appState.sidebar.standaloneKanbanMaxPanes,
    }),
    (target) => {
      if (!isOpen.get()) return;
      void rpc.app.updateStandaloneKanbanPanes(target);
    },
    { equals: comparer.structural }
  );

  return () => {
    openDisposer();
    reactionDisposer();
  };
}
