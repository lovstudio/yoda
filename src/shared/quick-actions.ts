import type { RuntimeId } from './runtime-registry';

export type ProjectLaunchCommand = {
  id: string;
  label: string;
  command: string;
  source: string;
};

export type CompileQuickActionInput = {
  projectId: string;
  intent: string;
  runtimeId: RuntimeId;
};

export type CompiledQuickAction = {
  label: string;
  command: string;
  explanation: string;
};
