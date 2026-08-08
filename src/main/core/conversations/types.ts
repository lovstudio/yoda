import {
  type AgentSessionSource,
  type Conversation,
  type ConversationAgent,
  type ConversationExecutionMode,
  type PendingInitialPrompt,
  type SessionRuntimeOverrides,
} from '@shared/conversations';
import type { SkillSessionPolicy } from '@shared/skills/types';

export type ActiveConversationSession = {
  sessionId: string;
  conversationId: string;
  projectId: string;
  taskId: string;
  pid?: number;
  taskTitle?: string;
  runtimeId: Conversation['runtimeId'];
  title: string;
  detachable: boolean;
};

export interface ConversationProvider {
  /** Absolute path of the worktree the agent runs in (used to locate transcripts). */
  readonly taskPath: string;
  startSession(
    conversation: Conversation,
    initialSize?: { cols: number; rows: number },
    isResuming?: boolean,
    initialPrompt?: string,
    /** Override the provider's default tmux behavior for this session only. */
    tmuxOverride?: boolean,
    /** Absolute local paths of image attachments to deliver with the initial prompt. */
    imagePaths?: string[],
    /** Explicit runtime parameters for a new session or supported resume-time overrides. */
    runtimeOverrides?: SessionRuntimeOverrides
  ): Promise<void>;
  stopSession(conversationId: string): Promise<void>;
  sendInput(conversationId: string, data: string): Promise<boolean>;
  getActiveSessions(): ActiveConversationSession[];
  destroyAll(): Promise<void>;
  detachAll(): Promise<void>;
}

export type ConversationConfig = {
  autoApprove?: boolean;
  agent?: ConversationAgent;
  permissionMode?: string;
  runtimeOverrides?: SessionRuntimeOverrides;
  skillPolicy?: SkillSessionPolicy;
  executionMode?: ConversationExecutionMode;
  sessionSource?: AgentSessionSource;
  /** Cleared only after the Agent session is spawned with its first prompt. */
  pendingInitialPrompt?: PendingInitialPrompt;
};
