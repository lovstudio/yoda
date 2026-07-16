import { useEffect } from 'react';
import {
  deepLinkOpenChannel,
  menuExportSettingsChannel,
  menuImportSettingsChannel,
  menuOpenSettingsChannel,
  menuRedoChannel,
  menuSyncSettingsChannel,
  menuToggleLeftSidebarChannel,
  menuUndoChannel,
  notificationFocusTaskChannel,
  taskWindowAssignTargetChannel,
} from '@shared/events/appEvents';
import {
  performActiveEditorRedo,
  performActiveEditorUndo,
} from '@renderer/lib/editor/activeCodeEditor';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { events, rpc } from '@renderer/lib/ipc';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { useNavigate, useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';
import {
  exportSettingsFile,
  importSettingsFile,
  restartAfterSettingsRestore,
  syncSettings,
} from '@renderer/lib/settings-sync';
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
  const { toast } = useToast();

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

  useEffect(() => {
    const reportError = (error: unknown) =>
      toast({
        title: '设置操作失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    const offImport = events.on(menuImportSettingsChannel, () => {
      void importSettingsFile()
        .then(async (result) => {
          if (result.status === 'imported') await restartAfterSettingsRestore();
        })
        .catch(reportError);
    });
    const offExport = events.on(menuExportSettingsChannel, () => {
      void exportSettingsFile()
        .then((result) => {
          if (result.status === 'exported') {
            toast({ title: '设置已导出', description: result.filePath });
          }
        })
        .catch(reportError);
    });
    const offSync = events.on(menuSyncSettingsChannel, () => {
      void syncSettings('auto')
        .then(async (result) => {
          if (result.status === 'downloaded') {
            await restartAfterSettingsRestore();
            return;
          }
          toast({
            title: result.status === 'conflict' ? '云端与本机设置存在冲突' : '设置同步完成',
            description:
              result.status === 'conflict' ? '请前往账号设置选择使用本机或云端配置。' : undefined,
          });
        })
        .catch(reportError);
    });
    return () => {
      offImport();
      offExport();
      offSync();
    };
  }, [toast]);

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
