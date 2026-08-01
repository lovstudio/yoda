import type { GeneralSessionConfig } from '@shared/general-session';
import { makePtySessionId } from '@shared/ptySessionId';
import type { Terminal } from '@shared/terminals';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { Pty } from '@main/core/pty/pty';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { resolveSshCommand } from '@main/core/pty/spawn-utils';
import { openSsh2Pty } from '@main/core/pty/ssh2-pty';
import { resolveAvailableTmuxSessionName } from '@main/core/pty/tmux-availability';
import { killTmuxSession } from '@main/core/pty/tmux-session-name';
import type { SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
import {
  sshConnectionManager,
  type SshConnectionEvent,
} from '@main/core/ssh/ssh-connection-manager';
import { hydratePersistedTerminals } from '@main/core/tasks/terminal-hydration';
import {
  TERMINAL_SPAWN_TIMEOUT_MS,
  TerminalSpawnCancelledError,
  TerminalSpawnTimeoutError,
  type LifecycleScriptSpawnRequest,
  type TerminalProvider,
  type TerminalSpawnOptions,
} from '@main/core/terminals/terminal-provider';
import { log } from '@main/lib/logger';
import { wireTerminalDevServerWatcher } from '../dev-server-watcher';
import { acquireSshTerminalOpenSlot } from './ssh-terminal-open-limiter';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_RESPAWNS = 2;

type SpawnPolicy = {
  respawnOnExit: boolean;
  preserveBufferOnExit: boolean;
  watchDevServer: boolean;
  trackForRehydrate: boolean;
};

type StartOperation = {
  readonly token: symbol;
  readonly terminalId: string;
  promise?: Promise<void>;
  registrationEpoch?: number;
  tmuxSessionName?: string;
  rejectCancellation?: (error: Error) => void;
};

export class SshTerminalOpenError extends Error {
  readonly code = 'ssh_terminal_open_failed';

  constructor(
    readonly terminalId: string,
    readonly kind: string,
    message: string
  ) {
    super(`Failed to open SSH terminal ${terminalId}: ${message}`);
    this.name = 'SshTerminalOpenError';
  }
}

export class SshTerminalProvider implements TerminalProvider {
  readonly terminalHydrationConcurrencyKey: string;
  private sessions = new Map<string, Pty>();
  private knownSessionIds = new Set<string>();
  private respawnCounts = new Map<string, number>();
  private terminals = new Map<string, Terminal>();
  private startOperations = new Map<string, StartOperation>();
  private respawnTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private rehydrateOperation: Promise<void> | null = null;
  private readonly projectId: string;
  private readonly scopeId: string;
  private readonly taskPath: string;
  private readonly taskEnvVars: Record<string, string>;
  private readonly tmux: boolean;
  private readonly shellSetup?: string;
  private readonly ctx: IExecutionContext;
  private readonly proxy: SshClientProxy;
  private readonly connectionId: string;
  private readonly _handleReconnect: (evt: SshConnectionEvent) => void;
  private reconnectListenerAttached = true;
  private readonly tmuxSessionNames = new Map<string, string>();

  constructor({
    projectId,
    scopeId,
    taskPath,
    taskEnvVars = {},
    tmux = false,
    shellSetup,
    ctx,
    proxy,
    connectionId,
  }: {
    projectId: string;
    scopeId: string;
    taskPath: string;
    taskEnvVars?: Record<string, string>;
    tmux?: boolean;
    shellSetup?: string;
    ctx: IExecutionContext;
    proxy: SshClientProxy;
    connectionId: string;
  }) {
    this.projectId = projectId;
    this.scopeId = scopeId;
    this.taskPath = taskPath;
    this.taskEnvVars = taskEnvVars;
    this.tmux = tmux;
    this.shellSetup = shellSetup;
    this.ctx = ctx;
    this.proxy = proxy;
    this.connectionId = connectionId;
    this.terminalHydrationConcurrencyKey = `ssh:${connectionId}`;
    this._handleReconnect = (evt: SshConnectionEvent) => {
      if (evt.type === 'reconnected' && evt.connectionId === this.connectionId) {
        this.rehydrate().catch((e: unknown) => {
          log.error('SshTerminalProvider: rehydrate failed after reconnect', {
            scopeId: this.scopeId,
            connectionId: this.connectionId,
            error: String(e),
          });
        });
      }
    };
    sshConnectionManager.on('connection-event', this._handleReconnect);
  }

  async spawnTerminal(
    terminal: Terminal,
    initialSize: { cols: number; rows: number } = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    command?: { command: string; args: string[] },
    options: TerminalSpawnOptions = {}
  ): Promise<void> {
    return this.spawnWithPolicy(
      terminal,
      initialSize,
      command,
      {
        respawnOnExit: true,
        preserveBufferOnExit: false,
        watchDevServer: true,
        trackForRehydrate: true,
      },
      options
    );
  }

  async spawnLifecycleScript({
    terminal,
    command,
    initialSize = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    respawnOnExit = false,
    preserveBufferOnExit = true,
    watchDevServer = false,
  }: LifecycleScriptSpawnRequest): Promise<void> {
    return this.spawnWithPolicy(
      terminal,
      initialSize,
      command === undefined ? undefined : { command, args: [] },
      {
        respawnOnExit,
        preserveBufferOnExit,
        watchDevServer,
        trackForRehydrate: false,
      },
      {}
    );
  }

  private spawnWithPolicy(
    terminal: Terminal,
    initialSize: { cols: number; rows: number },
    command: { command: string; args: string[] } | undefined,
    policy: SpawnPolicy,
    options: TerminalSpawnOptions = {}
  ): Promise<void> {
    if (options.signal?.aborted) {
      return Promise.reject(this.cancellationError(terminal.id, options.signal.reason));
    }
    const sessionId = makePtySessionId(terminal.projectId, terminal.taskId, terminal.id);
    this.knownSessionIds.add(sessionId);
    if (policy.trackForRehydrate) {
      this.terminals.set(terminal.id, terminal);
    }
    this.clearRespawnTimer(sessionId);
    if (this.sessions.has(sessionId)) return Promise.resolve();

    const existing = this.startOperations.get(sessionId);
    if (existing?.promise) return existing.promise;

    const operation: StartOperation = {
      token: Symbol(sessionId),
      terminalId: terminal.id,
    };
    this.startOperations.set(sessionId, operation);
    const start = this.runStartOperation(
      sessionId,
      terminal,
      initialSize,
      command,
      policy,
      operation
    );
    operation.promise = this.guardStartOperation(sessionId, operation, start, options).finally(
      () => {
        if (this.startOperations.get(sessionId) === operation) {
          this.startOperations.delete(sessionId);
        }
      }
    );
    return operation.promise;
  }

  private async runStartOperation(
    sessionId: string,
    terminal: Terminal,
    initialSize: { cols: number; rows: number },
    command: { command: string; args: string[] } | undefined,
    policy: SpawnPolicy,
    operation: StartOperation
  ): Promise<void> {
    const registrationEpoch = ptySessionRegistry.beginRegistration(sessionId);
    operation.registrationEpoch = registrationEpoch;
    let registrationCompleted = false;
    let spawnedPty: Pty | undefined;
    try {
      const tmuxSessionName = await this.resolveTmuxSessionName(sessionId);
      operation.tmuxSessionName = tmuxSessionName;
      if (!this.isCurrentStart(sessionId, operation)) return;

      const cfg: GeneralSessionConfig = {
        taskId: this.scopeId,
        cwd: this.taskPath,
        shellSetup: this.shellSetup,
        tmuxSessionName,
        command: command?.command,
        args: command?.args,
      };

      const profile = await this.proxy.getRemoteShellProfile();
      if (!this.isCurrentStart(sessionId, operation)) return;
      const sshCommand = resolveSshCommand('general', cfg, this.taskEnvVars, profile);

      if (!this.isCurrentStart(sessionId, operation)) return;
      const client = this.proxy.client;
      const releaseOpenSlot = await acquireSshTerminalOpenSlot(client);
      let result: Awaited<ReturnType<typeof openSsh2Pty>>;
      try {
        // An outer timeout may invalidate this generation while it waits for
        // a real ssh2 slot. Do not turn that stale queued work into a channel.
        if (!this.isCurrentStart(sessionId, operation)) return;
        result = await openSsh2Pty(client, {
          id: sessionId,
          command: sshCommand,
          cols: initialSize.cols,
          rows: initialSize.rows,
        });
      } finally {
        // The slot deliberately outlives the caller-facing timeout. It is
        // released only after openSsh2Pty's ssh2 callback actually settles.
        releaseOpenSlot();
      }

      if (!this.isCurrentStart(sessionId, operation)) {
        if (result.success) {
          await this.rollbackSpawnedPty(sessionId, result.data, operation);
        }
        return;
      }
      if (!result.success) {
        log.error('SshTerminalProvider: failed to open SSH channel', {
          sessionId,
          error: result.error.message,
        });
        throw new SshTerminalOpenError(terminal.id, result.error.kind, result.error.message);
      }
      const pty = result.data;
      spawnedPty = pty;
      this.sessions.set(sessionId, pty);

      if (policy.watchDevServer) {
        wireTerminalDevServerWatcher({
          pty,
          scopeId: this.scopeId,
          terminalId: terminal.id,
          probe: false,
        });
      }

      pty.onExit(() => {
        if (this.sessions.get(sessionId) !== pty) return;
        const shouldRespawn =
          policy.respawnOnExit && this.knownSessionIds.has(sessionId) && !this.tmux;
        this.sessions.delete(sessionId);
        if (shouldRespawn) {
          const count = (this.respawnCounts.get(sessionId) ?? 0) + 1;
          this.respawnCounts.set(sessionId, count);

          if (count > MAX_RESPAWNS) {
            log.error('SshTerminalProvider: respawn limit reached, giving up', {
              terminalId: terminal.id,
              respawnCount: count,
            });
            this.respawnCounts.delete(sessionId);
            return;
          }

          this.scheduleRespawn(sessionId, terminal, initialSize, command, policy);
        }
      });

      if (!this.isCurrentStart(sessionId, operation) || this.sessions.get(sessionId) !== pty) {
        await this.rollbackSpawnedPty(sessionId, pty, operation);
        return;
      }
      ptySessionRegistry.register(sessionId, pty, {
        preserveBufferOnExit: policy.preserveBufferOnExit,
        registrationEpoch,
        tmuxBacked: Boolean(tmuxSessionName),
      });
      registrationCompleted = true;
      if (!this.isCurrentStart(sessionId, operation)) {
        await this.rollbackSpawnedPty(sessionId, pty, operation);
        return;
      }
      if (this.sessions.get(sessionId) === pty && tmuxSessionName) {
        this.tmuxSessionNames.set(sessionId, tmuxSessionName);
      }
      spawnedPty = undefined;
    } catch (error) {
      if (spawnedPty) {
        await this.rollbackSpawnedPty(sessionId, spawnedPty, operation);
      }
      throw error;
    } finally {
      if (!registrationCompleted) {
        ptySessionRegistry.cancelRegistration(sessionId, registrationEpoch);
      }
    }
  }

  private isCurrentStart(sessionId: string, operation: StartOperation): boolean {
    return this.startOperations.get(sessionId)?.token === operation.token;
  }

  private guardStartOperation(
    sessionId: string,
    operation: StartOperation,
    start: Promise<void>,
    options: TerminalSpawnOptions
  ): Promise<void> {
    const timeoutMs = options.timeoutMs ?? TERMINAL_SPAWN_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;
    const cancellation = new Promise<never>((_, reject) => {
      operation.rejectCancellation = reject;
    });

    if (options.signal) {
      abortListener = () => {
        this.invalidateStart(
          sessionId,
          this.cancellationError(operation.terminalId, options.signal?.reason),
          operation
        );
      };
      options.signal.addEventListener('abort', abortListener, { once: true });
      if (options.signal.aborted) abortListener();
    }

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        this.invalidateStart(
          sessionId,
          new TerminalSpawnTimeoutError(operation.terminalId, timeoutMs),
          operation
        );
      }, timeoutMs);
      timer.unref?.();
    }

    return Promise.race([start, cancellation]).finally(() => {
      if (timer) clearTimeout(timer);
      if (options.signal && abortListener) {
        options.signal.removeEventListener('abort', abortListener);
      }
      operation.rejectCancellation = undefined;
    });
  }

  private cancellationError(terminalId: string, reason: unknown): Error {
    if (reason instanceof TerminalSpawnTimeoutError) return reason;
    return new TerminalSpawnCancelledError(terminalId);
  }

  private invalidateStart(
    sessionId: string,
    reason?: Error,
    expectedOperation?: StartOperation
  ): StartOperation | undefined {
    const operation = this.startOperations.get(sessionId);
    if (!operation || (expectedOperation && operation !== expectedOperation)) return undefined;
    this.startOperations.delete(sessionId);
    if (operation.registrationEpoch !== undefined) {
      ptySessionRegistry.cancelRegistration(sessionId, operation.registrationEpoch);
    }
    operation.rejectCancellation?.(reason ?? new TerminalSpawnCancelledError(operation.terminalId));
    return operation;
  }

  private async rollbackSpawnedPty(
    sessionId: string,
    pty: Pty,
    operation: StartOperation
  ): Promise<void> {
    if (this.sessions.get(sessionId) === pty) {
      this.sessions.delete(sessionId);
    }

    const currentSession = this.sessions.get(sessionId);
    const currentStart = this.startOperations.get(sessionId);
    if (
      ptySessionRegistry.get(sessionId) === pty ||
      (!currentSession && (!currentStart || currentStart.token === operation.token))
    ) {
      ptySessionRegistry.unregister(sessionId);
    }

    try {
      pty.kill();
    } catch (error) {
      log.warn('SshTerminalProvider: failed to kill rolled-back PTY', {
        sessionId,
        error: String(error),
      });
    }

    const tmuxSessionName = operation.tmuxSessionName;
    if (!tmuxSessionName) return;

    if (this.knownSessionIds.has(sessionId)) {
      // A timed-out generation is stale, but its persistent terminal is not.
      // Keep the tmux identity so reconnect or a later kill can reuse/clean it.
      this.tmuxSessionNames.set(sessionId, tmuxSessionName);
      return;
    }

    this.tmuxSessionNames.delete(sessionId);
    try {
      await killTmuxSession(this.ctx, tmuxSessionName);
    } catch (error) {
      log.warn('SshTerminalProvider: failed to clean rolled-back tmux session', {
        sessionId,
        tmuxSessionName,
        error: String(error),
      });
    }
  }

  private scheduleRespawn(
    sessionId: string,
    terminal: Terminal,
    initialSize: { cols: number; rows: number },
    command: { command: string; args: string[] } | undefined,
    policy: SpawnPolicy
  ): void {
    this.clearRespawnTimer(sessionId);
    const timer = setTimeout(() => {
      if (this.respawnTimers.get(sessionId) !== timer) return;
      this.respawnTimers.delete(sessionId);
      if (
        !this.knownSessionIds.has(sessionId) ||
        this.sessions.has(sessionId) ||
        this.startOperations.has(sessionId)
      ) {
        return;
      }
      this.spawnWithPolicy(terminal, initialSize, command, policy).catch((e) => {
        log.error('SshTerminalProvider: respawn failed', {
          terminalId: terminal.id,
          error: String(e),
        });
      });
    }, 500);
    timer.unref?.();
    this.respawnTimers.set(sessionId, timer);
  }

  private clearRespawnTimer(sessionId: string): void {
    const timer = this.respawnTimers.get(sessionId);
    if (!timer) return;
    clearTimeout(timer);
    this.respawnTimers.delete(sessionId);
  }

  private resolveTmuxSessionName(sessionId: string): Promise<string | undefined> {
    return resolveAvailableTmuxSessionName({
      auto: false,
      connectionId: this.connectionId,
      ctx: this.ctx,
      requested: this.tmux,
      sessionId,
      source: 'SshTerminalProvider',
    });
  }

  isTerminalDetachable(terminalId: string): boolean {
    const sessionId = makePtySessionId(this.projectId, this.scopeId, terminalId);
    return this.tmuxSessionNames.has(sessionId);
  }

  /**
   * Re-spawn all terminals whose sessions are no longer active (e.g. after
   * an SSH reconnect). Skips user-deleted terminals and terminals that are
   * already running.
   */
  rehydrate(): Promise<void> {
    if (this.rehydrateOperation) return this.rehydrateOperation;
    const terminals = Array.from(this.terminals.values()).filter((terminal) => {
      const sessionId = makePtySessionId(terminal.projectId, terminal.taskId, terminal.id);
      return !this.sessions.has(sessionId);
    });
    const operation = hydratePersistedTerminals(this, terminals, 'SshTerminalProvider: rehydrate', {
      shouldHydrate: (terminal) => {
        const sessionId = makePtySessionId(terminal.projectId, terminal.taskId, terminal.id);
        return this.terminals.get(terminal.id) === terminal && !this.sessions.has(sessionId);
      },
    });
    const trackedOperation = operation.finally(() => {
      if (this.rehydrateOperation === trackedOperation) this.rehydrateOperation = null;
    });
    this.rehydrateOperation = trackedOperation;
    return trackedOperation;
  }

  async killTerminal(terminalId: string): Promise<void> {
    const sessionId = makePtySessionId(this.projectId, this.scopeId, terminalId);
    this.knownSessionIds.delete(sessionId);
    this.clearRespawnTimer(sessionId);
    const pendingStart = this.invalidateStart(sessionId);
    const pty = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    ptySessionRegistry.unregister(sessionId);
    if (pty) {
      try {
        pty.kill();
      } catch {}
    }
    this.terminals.delete(terminalId);
    const tmuxSessionName = this.tmuxSessionNames.get(sessionId) ?? pendingStart?.tmuxSessionName;
    this.tmuxSessionNames.delete(sessionId);
    if (tmuxSessionName) {
      await killTmuxSession(this.ctx, tmuxSessionName);
    }
  }

  async destroyAll(): Promise<void> {
    const sessionIds = Array.from(this.knownSessionIds);
    const tmuxSessionNames = sessionIds.flatMap((id) => {
      const name = this.tmuxSessionNames.get(id) ?? this.startOperations.get(id)?.tmuxSessionName;
      return name ? [name] : [];
    });
    await this.detachAll();
    await Promise.all(tmuxSessionNames.map((name) => killTmuxSession(this.ctx, name)));
    this.knownSessionIds.clear();
    this.terminals.clear();
    this.tmuxSessionNames.clear();
  }

  async detachAll(): Promise<void> {
    if (this.reconnectListenerAttached) {
      this.reconnectListenerAttached = false;
      sshConnectionManager.off('connection-event', this._handleReconnect);
    }
    this.rehydrateOperation = null;
    const sessionIds = new Set([
      ...this.knownSessionIds,
      ...this.sessions.keys(),
      ...this.startOperations.keys(),
      ...this.respawnTimers.keys(),
    ]);
    const sessions = Array.from(this.sessions.entries());
    this.sessions.clear();
    for (const sessionId of sessionIds) {
      this.clearRespawnTimer(sessionId);
      this.invalidateStart(sessionId);
      ptySessionRegistry.unregister(sessionId);
    }
    for (const [, pty] of sessions) {
      try {
        pty.kill();
      } catch {}
    }
    this.knownSessionIds.clear();
    this.terminals.clear();
    this.respawnCounts.clear();
    this.tmuxSessionNames.clear();
  }
}
