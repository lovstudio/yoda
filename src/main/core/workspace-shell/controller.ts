import { createRPCController } from '@shared/ipc/rpc';
import { workspaceShellService } from './workspace-shell-service';

export const workspaceShellController = createRPCController({
  start: workspaceShellService.start.bind(workspaceShellService),
  execute: workspaceShellService.execute.bind(workspaceShellService),
  stop: workspaceShellService.stop.bind(workspaceShellService),
});
