import {
  defaultShareableProjectSettings,
  shareableProjectSettingsSchema,
  type ProjectSettings,
} from '@shared/project-settings';
import { mergeShareableProjectSettings } from '@shared/project-settings-fields';
import type { FileSystemProvider } from '@main/core/fs/types';
import { log } from '@main/lib/logger';
import type { ProjectSettingsProvider } from './provider';

export async function getEffectiveTaskSettings(args: {
  projectSettings: ProjectSettingsProvider;
  taskFs: FileSystemProvider;
  /**
   * Reuse a settings snapshot when the caller already loaded one for the same
   * provisioning pass. This avoids another database/SSH read on the task-open
   * hot path while preserving the existing standalone behavior.
   */
  loadedProjectSettings?: ProjectSettings;
}): Promise<ProjectSettings> {
  const { projectSettings, taskFs, loadedProjectSettings } = args;
  const parsedSettings = shareableProjectSettingsSchema.safeParse(
    loadedProjectSettings ?? (await projectSettings.get())
  );
  const localShareableSettings = parsedSettings.success ? parsedSettings.data : {};
  const defaults = defaultShareableProjectSettings();
  const exists = await taskFs.exists('.yoda.json');
  if (!exists) {
    return mergeShareableProjectSettings(defaults, localShareableSettings);
  }

  try {
    const { content } = await taskFs.read('.yoda.json');
    const projectFileSettings = shareableProjectSettingsSchema.parse(JSON.parse(content));
    return mergeShareableProjectSettings(defaults, projectFileSettings, localShareableSettings);
  } catch (err) {
    log.warn('Failed to parse task .yoda.json, falling back to project settings', err);
    return mergeShareableProjectSettings(defaults, localShareableSettings);
  }
}
