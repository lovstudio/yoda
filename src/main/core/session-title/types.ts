import type { AgentProviderId } from '@shared/agent-provider-registry';

export interface SessionTitleContext {
  providerId: AgentProviderId;
  /** Yoda conversation id — also passed to the agent CLI as session id when applicable. */
  conversationId: string;
  projectId: string;
  taskId: string;
  /** Absolute path of the worktree the agent runs in. */
  cwd: string;
  /** Timestamp captured immediately before spawning the agent process. */
  startedAtMs?: number;
  isResuming?: boolean;
}

export type TitleListener = (title: string) => void;

export interface SessionTitleWatcher {
  stop(): void;
}

export interface SessionTitleSource {
  readonly providerId: AgentProviderId;
  /** Start watching for title updates. Returns a watcher; call .stop() to detach. */
  watch(ctx: SessionTitleContext, onTitle: TitleListener): SessionTitleWatcher;
}
