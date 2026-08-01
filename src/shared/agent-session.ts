import type { RuntimeId } from '@shared/runtime-registry';

export interface AgentSessionConfig {
  taskId: string;
  conversationId: string;
  runtimeId: RuntimeId;
  command: string;
  args: string[];
  cwd: string;
  sessionId?: string;
  shellSetup?: string;
  tmuxSessionName?: string;
  tmuxEnv?: Record<string, string>;
  /** Agent thread bound to the reusable tmux session. */
  tmuxSessionIdentity?: string;
  /** Temporary identities accepted while the runtime's real thread is discovered. */
  tmuxSessionIdentityAliases?: string[];
  autoApprove: boolean;
  resume: boolean;
}
