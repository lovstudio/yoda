import { useEffect } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { workspaceStore } from '@renderer/lib/stores/app-state';

/**
 * Keeps the MobX workspace feature state aligned with the persisted app setting.
 * Bootstrap loads the same setting before restoring sidebar state; this agent
 * handles optimistic settings changes and later query refreshes.
 */
export function WorkspaceSettingsAgent() {
  const { value: taskSettings } = useAppSettingsKey('tasks');
  const workspacesEnabled = taskSettings?.workspacesEnabled;

  useEffect(() => {
    if (workspacesEnabled === undefined) return;
    workspaceStore.setEnabled(workspacesEnabled);
  }, [workspacesEnabled]);

  return null;
}
