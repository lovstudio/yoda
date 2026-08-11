import type { BrowserSessionHealthTargetInput } from '@shared/browser-session-health';
import { createRPCController } from '@shared/ipc/rpc';
import { browserSessionHealthService } from './browser-session-health-service';

export const browserSessionHealthController = createRPCController({
  getSnapshot: () => browserSessionHealthService.getSnapshot(),
  setEnabled: (enabled: boolean) => browserSessionHealthService.setEnabled(enabled),
  upsertTarget: (input: BrowserSessionHealthTargetInput) =>
    browserSessionHealthService.upsertTarget(input),
  removeTarget: (targetId: string) => browserSessionHealthService.removeTarget(targetId),
  runNow: (targetId?: string) => browserSessionHealthService.runNow(targetId),
  resumeAfterLogin: (targetId: string) => browserSessionHealthService.resumeAfterLogin(targetId),
  focusHandoff: () => browserSessionHealthService.focusHandoff(),
});
