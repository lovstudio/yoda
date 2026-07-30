import { getProjectSettingsStore } from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { resolveAttachImagesAsPaths } from './attach-images-as-paths';

/** Resolve the same global/project setting shown in the workspace runtime bar. */
export function useAttachImagesAsPaths(projectId: string): boolean {
  const { value: homeDraft } = useAppSettingsKey('homeDraft');
  const projectOverride =
    getProjectSettingsStore(projectId)?.settings?.composerDefaults?.attachImagesAsPaths;
  return resolveAttachImagesAsPaths(homeDraft?.attachImagesAsPaths, projectOverride);
}
