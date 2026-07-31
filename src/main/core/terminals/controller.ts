import { createRPCController } from '@shared/ipc/rpc';
import { createTerminal } from './createTerminal';
import { deleteTerminal } from './deleteTerminal';
import { getAllTerminals } from './getAllTerminals';
import { getTerminalsForTask } from './getTerminalsForTask';
import { renameTerminal } from './renameTerminal';
import { runLifecycleScript } from './runLifecycleScript';
import { workspaceTerminalService } from './workspace-terminal-service';

export const terminalsController = createRPCController({
  getAllTerminals,
  createTerminal,
  deleteTerminal,
  renameTerminal,
  getTerminalsForTask,
  runLifecycleScript,
  getWorkspaceTerminals: workspaceTerminalService.getTerminals.bind(workspaceTerminalService),
  createWorkspaceTerminal: workspaceTerminalService.createTerminal.bind(workspaceTerminalService),
  deleteWorkspaceTerminal: workspaceTerminalService.deleteTerminal.bind(workspaceTerminalService),
  renameWorkspaceTerminal: workspaceTerminalService.renameTerminal.bind(workspaceTerminalService),
  runWorkspaceRuntimeAction:
    workspaceTerminalService.runRuntimeAction.bind(workspaceTerminalService),
});
