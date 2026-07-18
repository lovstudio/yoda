import type {
  CreateAiLabAppInput,
  LogoGenerationInput,
  PrepareAiLabBuildTaskInput,
  UpdateAiLabAppInput,
} from '@shared/ai-lab';
import type { AiLabImageEditInput } from '@shared/ai-lab-bridge';
import { createRPCController } from '@shared/ipc/rpc';
import { aiLabService } from './ai-lab-service';

async function listEngines() {
  return aiLabService.listEngines();
}

async function generateLogo(input: LogoGenerationInput) {
  return aiLabService.generateLogo(input);
}

async function listGenerations() {
  return aiLabService.listGenerations();
}

async function getGenerationImage(input: { id: string; index: number }) {
  return aiLabService.getGenerationImage(input);
}

async function saveGenerationImage(input: { id: string; index: number }) {
  return aiLabService.saveGenerationImage(input);
}

async function copyGenerationImage(input: { id: string; index: number }) {
  return aiLabService.copyGenerationImage(input);
}

async function deleteGeneration(id: string) {
  return aiLabService.deleteGeneration(id);
}

async function listApps() {
  return aiLabService.listApps();
}

async function editAppImage(input: AiLabImageEditInput) {
  return aiLabService.editAppImage(input);
}

async function createApp(input: CreateAiLabAppInput) {
  return aiLabService.createApp(input);
}

async function prepareBuildTask(input: PrepareAiLabBuildTaskInput) {
  return aiLabService.prepareBuildTask(input);
}

async function cancelBuildTask(taskId: string) {
  return aiLabService.cancelBuildTask(taskId);
}

async function updateApp(input: UpdateAiLabAppInput) {
  return aiLabService.updateApp(input);
}

async function deleteApp(id: string) {
  return aiLabService.deleteApp(id);
}

export const aiLabController = createRPCController({
  listEngines,
  generateLogo,
  listGenerations,
  getGenerationImage,
  saveGenerationImage,
  copyGenerationImage,
  deleteGeneration,
  listApps,
  editAppImage,
  createApp,
  prepareBuildTask,
  cancelBuildTask,
  updateApp,
  deleteApp,
});
