import { useEffect } from 'react';
import {
  deepLinkOpenChannel,
  menuOpenSettingsChannel,
  menuRedoChannel,
  menuToggleLeftSidebarChannel,
  menuUndoChannel,
  notificationFocusTaskChannel,
  taskWindowAssignTargetChannel,
} from '@shared/events/appEvents';
import {
  performActiveEditorRedo,
  performActiveEditorUndo,
} from '@renderer/lib/editor/activeCodeEditor';
import { events, rpc } from '@renderer/lib/ipc';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { useNavigate, useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';
import {
  getTaskWindowLaunchTarget,
  isWarmTaskWindow,
} from '@renderer/lib/task-window-launch-target';
import { log } from '@renderer/utils/logger';
import { openTaskTarget, openTaskWindowTarget } from './open-task-target';

export function AppMenuEvents({ onOpenSettings }: { onOpenSettings?: () => boolean | void }) {
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();
  const { toggleLeft } = useWorkspaceLayoutContext();

  useEffect(() => {
    return events.on(menuOpenSettingsChannel, () => {
      const shouldOpen = onOpenSettings?.() ?? true;
      if (shouldOpen === false) return;
      if (currentView === 'settings') return;

      navigate('settings');
    });
  }, [navigate, onOpenSettings, currentView]);

  useEffect(() => {
    return events.on(menuToggleLeftSidebarChannel, () => toggleLeft());
  }, [toggleLeft]);

  // Menu Undo/Redo (Cmd/Ctrl+Z) arrives as an event because the Edit menu
  // routes through the renderer to keep undo scoped to the focused Monaco
  // editor; for everything else fall back to the native editing pipeline.
  useEffect(() => {
    const run = (action: () => void) => {
      // The menu click can transiently blur the focused input; give focus a
      // frame to restore before dispatching.
      requestAnimationFrame(action);
    };
    const offUndo = events.on(menuUndoChannel, () =>
      run(() => {
        if (performActiveEditorUndo()) return;
        document.execCommand('undo');
      })
    );
    const offRedo = events.on(menuRedoChannel, () =>
      run(() => {
        if (performActiveEditorRedo()) return;
        document.execCommand('redo');
      })
    );
    return () => {
      offUndo();
      offRedo();
    };
  }, []);

  useEffect(() => {
    const disposers = new Set<() => void>();

    const launchTarget = getTaskWindowLaunchTarget();
    if (launchTarget) {
      openTaskWindowTarget(launchTarget, navigate, disposers);
    }

    const unlistenNotifications = events.on(notificationFocusTaskChannel, (target) =>
      openTaskTarget(target, navigate, disposers)
    );
    const unlistenDeepLinks = events.on(deepLinkOpenChannel, (target) =>
      openTaskTarget(target, navigate, disposers)
    );
    // A warm window navigates to its tab when the main process assigns a target.
    const unlistenAssign = events.on(taskWindowAssignTargetChannel, (target) =>
      openTaskWindowTarget(target, navigate, disposers)
    );

    if (!launchTarget && !isWarmTaskWindow) {
      void rpc.app
        .consumePendingDeepLinks()
        .then((targets) => {
          for (const target of targets) openTaskTarget(target, navigate, disposers);
        })
        .catch((error: unknown) => {
          log.warn('AppMenuEvents: failed to consume pending deep links', { error });
        });
    }

    return () => {
      unlistenNotifications();
      unlistenDeepLinks();
      unlistenAssign();
      disposers.forEach((dispose) => dispose());
      disposers.clear();
    };
  }, [navigate]);

  return null;
}
