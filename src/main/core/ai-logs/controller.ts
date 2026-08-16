import type { AiLogListInput } from '@shared/ai-logs';
import { createRPCController } from '@shared/ipc/rpc';
import { aiLogService } from './ai-log-service';
import { resolveAiLogTrace } from './transcript-trace';

async function list(input?: AiLogListInput) {
  return aiLogService.list(input ?? {});
}

async function clear() {
  return aiLogService.clear();
}

/** What ran inside one invocation, read from the provider transcript on demand. */
async function getTrace(logId: string) {
  return resolveAiLogTrace(logId);
}

export const aiLogsController = createRPCController({
  list,
  clear,
  getTrace,
});
