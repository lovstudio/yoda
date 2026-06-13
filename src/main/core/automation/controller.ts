import type { AutomationCreateInput, AutomationUpdateInput } from '@shared/automation';
import { createRPCController } from '@shared/ipc/rpc';
import { automationRunner } from './automation-runner';
import { automationService } from './automation-service';

export const automationController = createRPCController({
  list: () => automationService.list(),
  create: (input: AutomationCreateInput) => automationService.create(input),
  update: (id: string, patch: AutomationUpdateInput) => automationService.update(id, patch),
  delete: (id: string) => automationService.remove(id),
  run: (id: string) => automationRunner.fire(id, 'manual'),
  history: (automationId?: string, limit?: number) =>
    automationService.listRuns(automationId, limit),
});
