import type { CreateAiLabAppInput, LogoGenerationInput, UpdateAiLabAppInput } from '@shared/ai-lab';
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

async function createApp(input: CreateAiLabAppInput) {
  return aiLabService.createApp(input);
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
  createApp,
  updateApp,
  deleteApp,
});
