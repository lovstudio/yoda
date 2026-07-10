import type { RuntimeId } from './runtime-registry';

export const WORKSPACE_SHELL_ACTIONS = ['open', 'update', 'login', 'doctor'] as const;
export type WorkspaceShellAction = (typeof WORKSPACE_SHELL_ACTIONS)[number];

export type WorkspaceShellRuntimeAction = {
  runtimeId: RuntimeId;
  action: WorkspaceShellAction;
};

export type StartWorkspaceShellParams = {
  sessionId: string;
  cwd?: string;
  initialSize?: { cols: number; rows: number };
};
