import type { RuntimeId } from './runtime-registry';

export type ProjectPackageScript = {
  id: string;
  label: string;
  command: string;
  source: string;
};

export type CompileQuickActionInput = {
  projectId: string;
  intent: string;
  runtimeId: RuntimeId;
  taskContext?: {
    taskId: string;
    conversationId: string;
  };
};

export type CompiledQuickAction =
  | {
      kind: 'none';
      explanation: string;
    }
  | {
      kind: 'command';
      label: string;
      command: string;
      explanation: string;
    }
  | {
      kind: 'skill';
      label: string;
      instruction: string;
      explanation: string;
    };
