import { useEffect, useRef } from 'react';
import { isComparisonWindowLaunch } from '@renderer/lib/comparison-window-launch-target';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { rpc } from '@renderer/lib/ipc';
import { restartAfterSettingsRestore, syncSettings } from '@renderer/lib/settings-sync';
import { isTaskWindowLaunch } from '@renderer/lib/task-window-launch-target';

const AUTO_SYNC_INTERVAL_MS = 5 * 60_000;

export function SettingsSyncAgent() {
  const { data: session } = useAccountSession();
  const runningRef = useRef(false);

  useEffect(() => {
    if (!session?.isSignedIn || isTaskWindowLaunch || isComparisonWindowLaunch) return;
    let disposed = false;

    const run = async () => {
      if (runningRef.current || disposed) return;
      runningRef.current = true;
      try {
        const status = await rpc.settingsSync.getStatus();
        if (!status.autoSyncEnabled || disposed) return;
        const result = await syncSettings('auto');
        if (result.status === 'downloaded' && !disposed) {
          await restartAfterSettingsRestore();
        }
      } catch {
        // Background sync is best-effort. The Account settings surface exposes
        // actionable errors and manual upload/download controls.
      } finally {
        runningRef.current = false;
      }
    };

    const initial = window.setTimeout(() => void run(), 2_000);
    const interval = window.setInterval(() => void run(), AUTO_SYNC_INTERVAL_MS);
    const onFocus = () => void run();
    window.addEventListener('focus', onFocus);
    return () => {
      disposed = true;
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [session?.isSignedIn, session?.user?.userId]);

  return null;
}
