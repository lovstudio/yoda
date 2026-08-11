import type { RuntimeId } from '@shared/runtime-registry';

export interface SessionTitleContext {
  runtimeId: RuntimeId;
  /** Yoda conversation id — also passed to the agent CLI as session id when applicable. */
  conversationId: string;
  projectId: string;
  taskId: string;
  /** Absolute path of the worktree the agent runs in. */
  cwd: string;
  /** Provider-native id when it differs from Yoda's stable conversation id. */
  agentSessionId?: string;
  /** Provider state root selected by Yoda's local session catalog. */
  stateRoot?: string;
  /** Timestamp captured immediately before spawning the agent process. */
  startedAtMs?: number;
  isResuming?: boolean;
  /** Delay durable binding until a fresh session records its first turn. */
  waitForInitialPrompt?: boolean;
  /** Effective prompt passed to the fresh provider process, for ownership matching. */
  expectedInitialPrompt?: string;
  /** Persisted delivery-attempt token used to reject stale native binding callbacks. */
  initialPromptAttemptStartedAtMs?: number;
}

export type TitleListener = (title: string) => void;
export type SessionBindingListener = (
  sessionId: string
) => boolean | void | Promise<boolean | void>;

export interface SessionTitleWatcher {
  stop(): void;
}

export interface SessionTitleSource {
  readonly runtimeId: RuntimeId;
  /** Start watching for title updates. Returns a watcher; call .stop() to detach. */
  watch(
    ctx: SessionTitleContext,
    onTitle: TitleListener,
    onSessionBound?: SessionBindingListener
  ): SessionTitleWatcher;
}
