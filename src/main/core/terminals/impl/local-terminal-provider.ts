import { makePtySessionId } from '@shared/ptySessionId';
import type { Terminal } from '@shared/terminals';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { spawnLocalPty } from '@main/core/pty/local-pty';
import type { Pty } from '@main/core/pty/pty';
import { buildTerminalEnv } from '@main/core/pty/pty-env';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import {
  logLocalPtySpawnWarnings,
  resolveLocalPtySpawn,
  type PtyCommandSpec,
  type PtySpawnIntent,
} from '@main/core/pty/pty-spawn-platform';
import { resolveAvailableTmuxSessionName } from '@main/core/pty/tmux-availability';
import { killTmuxSession } from '@main/core/pty/tmux-session-name';
import { log } from '@main/lib/logger';
import { wireTerminalDevServerWatcher } from '../dev-server-watcher';
import {
  TERMINAL_SPAWN_TIMEOUT_MS,
  TerminalSpawnCancelledError,
  TerminalSpawnTimeoutError,
  type LifecycleScriptSpawnRequest,
  type TerminalProvider,
  type TerminalSpawnOptions,
} from '../terminal-provider';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_RESPAWNS = 2;

type SpawnPolicy = {
  respawnOnExit: boolean;
  preserveBufferOnExit: boolean;
  watchDevServer: boolean;
};

type StartOperation = {
  readonly token: symbol;
  readonly registrationEpoch: number;
  readonly terminalId: string;
  promise: Promise<void>;
  rejectCancellation?: (error: Error) => void;
};

export class LocalTerminalProvider implements TerminalProvider {
  readonly terminalHydrationConcurrencyKey = 'local';
  private sessions = new Map<string, Pty>();
  private knownSessionIds = new Set<string>();
  private respawnCounts = new Map<string, number>();
  private readonly startOperations = new Map<string, StartOperation>();
  private readonly respawnTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly projectId: string;
  private readonly scopeId: string;
  private readonly taskPath: string;
  private readonly tmux: boolean;
  private readonly shellSetup?: string;
  private readonly ctx: IExecutionContext;
  private readonly taskEnvVars: Record<string, string>;
  private readonly tmuxSessionNames = new Map<string, string>();

  constructor({
    projectId,
    scopeId,
    taskPath,
    tmux = false,
    shellSetup,
    ctx,
    taskEnvVars = {},
  }: {
    projectId: string;
    scopeId: string;
    taskPath: string;
    tmux?: boolean;
    shellSetup?: string;
    ctx: IExecutionContext;
    taskEnvVars?: Record<string, string>;
  }) {
    this.projectId = projectId;
    this.scopeId = scopeId;
    this.taskPath = taskPath;
    this.tmux = tmux;
    this.shellSetup = shellSetup;
    this.ctx = ctx;
    this.taskEnvVars = taskEnvVars;
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
      command ? { kind: 'argv', command: command.command, args: command.args } : undefined,
      {
        respawnOnExit: true,
        preserveBufferOnExit: false,
        watchDevServer: true,
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
      command === undefined ? undefined : { kind: 'shell-line', commandLine: command },
      {
        respawnOnExit,
        preserveBufferOnExit,
        watchDevServer,
      }
    );
  }

  private spawnWithPolicy(
    terminal: Terminal,
    initialSize: { cols: number; rows: number },
    command: PtyCommandSpec | undefined,
    policy: SpawnPolicy,
    options: TerminalSpawnOptions = {}
  ): Promise<void> {
    if (options.signal?.aborted) {
      return Promise.reject(this.cancellationError(terminal.id, options.signal.reason));
    }
    const sessionId = makePtySessionId(terminal.projectId, terminal.taskId, terminal.id);
    this.knownSessionIds.add(sessionId);
    this.clearRespawnTimer(sessionId);
    const existingOperation = this.startOperations.get(sessionId);
    if (existingOperation) return existingOperation.promise;
    if (this.sessions.has(sessionId)) return Promise.resolve();

    const registrationEpoch = ptySessionRegistry.beginRegistration(sessionId);
    const operation: StartOperation = {
      token: Symbol(sessionId),
      registrationEpoch,
      terminalId: terminal.id,
      promise: Promise.resolve(),
    };
    this.startOperations.set(sessionId, operation);
    const start = this.performSpawn(sessionId, terminal, initialSize, command, policy, operation);
    operation.promise = this.guardStartOperation(sessionId, operation, start, options).finally(
      () => {
        if (this.startOperations.get(sessionId) === operation) {
          this.startOperations.delete(sessionId);
        }
      }
    );
    return operation.promise;
  }

  private async performSpawn(
    sessionId: string,
    terminal: Terminal,
    initialSize: { cols: number; rows: number },
    command: PtyCommandSpec | undefined,
    policy: SpawnPolicy,
    operation: StartOperation
  ): Promise<void> {
    let pty: Pty | undefined;
    let registrationCompleted = false;
    try {
      const tmuxSessionName = await this.resolveTmuxSessionName(sessionId);
      if (!this.isCurrentStart(sessionId, operation)) return;

      const intent: PtySpawnIntent = command
        ? {
            kind: 'run-command',
            cwd: this.taskPath,
            command,
            shellSetup: this.shellSetup,
            tmuxSessionName,
            tmuxSize: initialSize,
          }
        : {
            kind: 'interactive-shell',
            cwd: this.taskPath,
            shellSetup: this.shellSetup,
            tmuxSessionName,
            tmuxSize: initialSize,
          };
      const resolved = resolveLocalPtySpawn({
        platform: process.platform,
        env: process.env,
        intent,
      });

      logLocalPtySpawnWarnings('LocalTerminalProvider', resolved.warnings, {
        terminalId: terminal.id,
        sessionId,
      });

      if (
        !(await ptySessionRegistry.waitForRevealClaims(sessionId, operation.registrationEpoch)) ||
        !this.isCurrentStart(sessionId, operation)
      ) {
        return;
      }
      if (!this.isCurrentStart(sessionId, operation)) return;
      pty = spawnLocalPty({
        id: sessionId,
        command: resolved.command,
        args: resolved.args,
        cwd: resolved.cwd,
        env: { ...buildTerminalEnv(), ...this.taskEnvVars },
        cols: initialSize.cols,
        rows: initialSize.rows,
      });
      if (!this.isCurrentStart(sessionId, operation)) {
        this.rollbackSpawn(sessionId, pty, operation);
        return;
      }

      this.sessions.set(sessionId, pty);
      pty.onExit(() => {
        if (this.sessions.get(sessionId) !== pty) return;
        this.sessions.delete(sessionId);
        const shouldRespawn =
          policy.respawnOnExit && this.knownSessionIds.has(sessionId) && !this.tmux;
        if (!shouldRespawn) return;

        const count = (this.respawnCounts.get(sessionId) ?? 0) + 1;
        this.respawnCounts.set(sessionId, count);

        if (count > MAX_RESPAWNS) {
          log.error('LocalTerminalProvider: respawn limit reached, giving up', {
            terminalId: terminal.id,
            respawnCount: count,
          });
          this.respawnCounts.delete(sessionId);
          return;
        }

        this.scheduleRespawn(sessionId, terminal, initialSize, command, policy);
      });
      if (policy.watchDevServer) {
        wireTerminalDevServerWatcher({ pty, scopeId: this.scopeId, terminalId: terminal.id });
      }
      if (!this.isCurrentStart(sessionId, operation)) {
        this.rollbackSpawn(sessionId, pty, operation);
        return;
      }

      ptySessionRegistry.register(sessionId, pty, {
        preserveBufferOnExit: policy.preserveBufferOnExit,
        registrationEpoch: operation.registrationEpoch,
        tmuxBacked: Boolean(tmuxSessionName),
      });
      registrationCompleted = true;
      if (!this.isCurrentStart(sessionId, operation)) {
        this.rollbackSpawn(sessionId, pty, operation);
        return;
      }
      if (this.sessions.get(sessionId) === pty && tmuxSessionName) {
        this.tmuxSessionNames.set(sessionId, tmuxSessionName);
      }
    } catch (error) {
      if (pty) this.rollbackSpawn(sessionId, pty, operation);
      throw error;
    } finally {
      if (!registrationCompleted) {
        ptySessionRegistry.cancelRegistration(sessionId, operation.registrationEpoch);
      }
    }
  }

  private isCurrentStart(sessionId: string, operation: StartOperation): boolean {
    return (
      this.startOperations.get(sessionId)?.token === operation.token &&
      this.knownSessionIds.has(sessionId)
    );
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
        this.abortPendingStart(
          sessionId,
          this.cancellationError(operation.terminalId, options.signal?.reason)
        );
      };
      options.signal.addEventListener('abort', abortListener, { once: true });
      if (options.signal.aborted) abortListener();
    }

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        this.abortPendingStart(
          sessionId,
          new TerminalSpawnTimeoutError(operation.terminalId, timeoutMs)
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

  private abortPendingStart(sessionId: string, reason: Error): void {
    this.cancelPendingStart(sessionId, reason);
  }

  private cancelPendingStart(sessionId: string, reason?: Error): void {
    const operation = this.startOperations.get(sessionId);
    if (!operation) return;
    this.startOperations.delete(sessionId);
    this.knownSessionIds.delete(sessionId);
    ptySessionRegistry.cancelRegistration(sessionId, operation.registrationEpoch);
    operation.rejectCancellation?.(reason ?? new TerminalSpawnCancelledError(operation.terminalId));
  }

  private rollbackSpawn(sessionId: string, pty: Pty, operation: StartOperation): void {
    if (this.sessions.get(sessionId) === pty) {
      this.sessions.delete(sessionId);
    }
    try {
      pty.kill();
    } catch {}
    const currentOperation = this.startOperations.get(sessionId);
    const hasReplacementStart =
      currentOperation !== undefined && currentOperation.token !== operation.token;
    if (!this.sessions.has(sessionId) && !hasReplacementStart) {
      ptySessionRegistry.unregister(sessionId);
    }
    ptySessionRegistry.cancelRegistration(sessionId, operation.registrationEpoch);
  }

  private scheduleRespawn(
    sessionId: string,
    terminal: Terminal,
    initialSize: { cols: number; rows: number },
    command: PtyCommandSpec | undefined,
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
        log.error('LocalTerminalProvider: respawn failed', {
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
      ctx: this.ctx,
      requested: this.tmux,
      sessionId,
      source: 'LocalTerminalProvider',
    });
  }

  isTerminalDetachable(terminalId: string): boolean {
    const sessionId = makePtySessionId(this.projectId, this.scopeId, terminalId);
    return this.tmuxSessionNames.has(sessionId);
  }

  async killTerminal(terminalId: string): Promise<void> {
    const sessionId = makePtySessionId(this.projectId, this.scopeId, terminalId);
    this.knownSessionIds.delete(sessionId);
    this.clearRespawnTimer(sessionId);
    this.cancelPendingStart(sessionId);
    const pty = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    ptySessionRegistry.unregister(sessionId);
    if (pty) {
      try {
        pty.kill();
      } catch {}
    }
    const tmuxSessionName = this.tmuxSessionNames.get(sessionId);
    this.tmuxSessionNames.delete(sessionId);
    if (tmuxSessionName) {
      await killTmuxSession(this.ctx, tmuxSessionName);
    }
  }

  async destroyAll(): Promise<void> {
    const sessionIds = Array.from(this.knownSessionIds);
    const tmuxSessionNames = sessionIds.flatMap((id) => {
      const name = this.tmuxSessionNames.get(id);
      return name ? [name] : [];
    });
    await this.detachAll();
    await Promise.all(tmuxSessionNames.map((name) => killTmuxSession(this.ctx, name)));
    this.knownSessionIds.clear();
    this.tmuxSessionNames.clear();
  }

  async detachAll(): Promise<void> {
    const sessionIds = new Set([
      ...this.knownSessionIds,
      ...this.startOperations.keys(),
      ...this.sessions.keys(),
      ...this.respawnTimers.keys(),
    ]);
    this.knownSessionIds.clear();
    for (const sessionId of sessionIds) {
      this.clearRespawnTimer(sessionId);
      this.cancelPendingStart(sessionId);
      const pty = this.sessions.get(sessionId);
      this.sessions.delete(sessionId);
      ptySessionRegistry.unregister(sessionId);
      if (!pty) continue;
      try {
        pty.kill();
      } catch {}
    }
    this.sessions.clear();
    this.respawnCounts.clear();
  }
}
