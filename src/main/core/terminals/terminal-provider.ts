import type { Terminal } from '@shared/terminals';

export type LifecycleScriptSpawnRequest = {
  terminal: Terminal;
  command?: string;
  initialSize?: { cols: number; rows: number };
  respawnOnExit?: boolean;
  preserveBufferOnExit?: boolean;
  watchDevServer?: boolean;
};

export const TERMINAL_SPAWN_TIMEOUT_MS = 15_000;

export type TerminalSpawnOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export class TerminalSpawnCancelledError extends Error {
  readonly code = 'terminal_spawn_cancelled';

  constructor(readonly terminalId: string) {
    super(`Terminal spawn was cancelled: ${terminalId}`);
    this.name = 'TerminalSpawnCancelledError';
  }
}

export class TerminalSpawnTimeoutError extends Error {
  readonly code = 'terminal_spawn_timeout';

  constructor(
    readonly terminalId: string,
    readonly timeoutMs: number
  ) {
    super(`Terminal spawn timed out after ${timeoutMs}ms: ${terminalId}`);
    this.name = 'TerminalSpawnTimeoutError';
  }
}

export interface TerminalProvider {
  /**
   * Providers with the same key share the persisted-terminal hydration limit.
   * SSH providers use their connection ID so reconnecting many task scopes
   * cannot multiply channel-open concurrency.
   */
  readonly terminalHydrationConcurrencyKey?: string;
  spawnTerminal(
    terminal: Terminal,
    initialSize?: { cols: number; rows: number },
    command?: { command: string; args: string[] },
    options?: TerminalSpawnOptions
  ): Promise<void>;
  spawnLifecycleScript(request: LifecycleScriptSpawnRequest): Promise<void>;
  isTerminalDetachable(terminalId: string): boolean;
  killTerminal(terminalId: string): Promise<void>;
  destroyAll(): Promise<void>;
  detachAll(): Promise<void>;
}
