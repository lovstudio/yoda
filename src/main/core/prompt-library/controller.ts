import { createRPCController } from '@shared/ipc/rpc';
import type {
  PromptCreateInput,
  PromptUpdateInput,
  PromptVersionBump,
} from '@shared/prompt-library';
import { promptLibraryService } from './prompt-library-service';
import { promptSourceService } from './prompt-source-service';

export const promptLibraryController = createRPCController({
  list: () => promptLibraryService.list(),
  listVersions: (id: string) => promptLibraryService.listVersions(id),
  reorderPrompts: (ids: string[]) => promptLibraryService.reorderPrompts(ids),
  setTagInjectionEnabled: (tag: string, enabled: boolean) =>
    promptLibraryService.setTagInjectionEnabled(tag, enabled),
  create: async (input: PromptCreateInput) => {
    const prompt = await promptLibraryService.create(input);
    await promptSourceService.reconcile();
    return prompt;
  },
  update: async (id: string, patch: PromptUpdateInput) => {
    const prompt = await promptLibraryService.update(id, patch);
    await promptSourceService.reconcile();
    return prompt;
  },
  restoreVersion: async (id: string, version: string, bump: PromptVersionBump) => {
    const prompt = await promptLibraryService.restoreVersion(id, version, bump);
    await promptSourceService.reconcile();
    return prompt;
  },
  delete: async (id: string) => {
    await promptLibraryService.remove(id);
    await promptSourceService.reconcile();
  },
  selectFile: () => promptSourceService.selectFile(),
  loadUrl: (input: { refreshIntervalMinutes?: number; timeoutSeconds?: number; url: string }) =>
    promptSourceService.loadUrl(input),
  loadGit: (input: {
    filePath: string;
    ref?: string;
    refreshIntervalMinutes?: number;
    repositoryUrl: string;
    timeoutSeconds?: number;
  }) => promptSourceService.loadGit(input),
  refreshSource: (id: string) => promptSourceService.refresh(id),
});
