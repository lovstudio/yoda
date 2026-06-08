import { type Conversation } from '@shared/conversations';

export type ActiveConversationSession = {
  sessionId: string;
  conversationId: string;
  projectId: string;
  taskId: string;
  taskTitle?: string;
  providerId: Conversation['providerId'];
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
    tmuxOverride?: boolean
  ): Promise<void>;
  stopSession(conversationId: string): Promise<void>;
  getActiveSessions(): ActiveConversationSession[];
  destroyAll(): Promise<void>;
  detachAll(): Promise<void>;
}

export type ConversationConfig = {
  autoApprove?: boolean;
};
