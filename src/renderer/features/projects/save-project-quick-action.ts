import type { QuickAction } from '@shared/project-settings';
import { getProjectSettingsStore } from '@renderer/features/projects/stores/project-selectors';

export async function saveProjectQuickAction(
  projectId: string,
  action: QuickAction
): Promise<boolean> {
  const settingsStore = getProjectSettingsStore(projectId);
  if (!settingsStore) return false;

  await settingsStore.pageData.load();
  const currentSettings = settingsStore.settings;
  if (!currentSettings) return false;

  const currentActions = currentSettings.quickActions ?? [];
  const sourceIntent = action.sourceIntent?.trim();
  const existing = currentActions.find(
    (item) =>
      (Boolean(sourceIntent) && item.sourceIntent?.trim() === sourceIntent) ||
      (item.kind === action.kind && item.command.trim() === action.command.trim())
  );
  const savedAction = existing ? { ...action, id: existing.id } : action;
  const nextActions = existing
    ? currentActions.map((item) => (item.id === existing.id ? savedAction : item))
    : [...currentActions, savedAction];
  const nextSettings = JSON.parse(
    JSON.stringify({ ...currentSettings, quickActions: nextActions })
  ) as typeof currentSettings;

  return (await settingsStore.save(nextSettings)).success;
}
