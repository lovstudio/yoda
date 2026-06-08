import type { HookInspectionResult, TaskHookOverrides } from '@shared/agent-hooks';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { createRPCController } from '@shared/ipc/rpc';
import { inspectHooks } from './inspect/hook-inspector';
import { hookOverridesStore } from './inspect/hook-overrides-store';

async function inspect(
  cwd: string,
  providerId: AgentProviderId,
  taskId: string
): Promise<HookInspectionResult> {
  const overrides = await hookOverridesStore.get(taskId);
  return inspectHooks(cwd, providerId, overrides);
}

async function getOverrides(taskId: string): Promise<TaskHookOverrides> {
  return hookOverridesStore.get(taskId);
}

async function setHookEnabled(taskId: string, hookId: string, enabled: boolean): Promise<void> {
  await hookOverridesStore.setHookEnabled(taskId, hookId, enabled);
}

async function setDebug(taskId: string, debug: boolean): Promise<void> {
  await hookOverridesStore.setDebug(taskId, debug);
}

export const agentHooksController = createRPCController({
  inspect,
  getOverrides,
  setHookEnabled,
  setDebug,
});
