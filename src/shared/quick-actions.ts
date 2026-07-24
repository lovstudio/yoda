import type { RuntimeId } from './runtime-registry';

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
