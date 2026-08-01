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
import {
  type LifecycleScriptSpawnRequest,
  type TerminalProvider,
} from '@main/core/terminals/terminal-provider';
import { log } from '@main/lib/logger';
import { wireTerminalDevServerWatcher } from '../dev-server-watcher';

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
  promise?: Promise<void>;
  registrationEpoch?: number;
  tmuxSessionName?: string;
};

export class SshTerminalProvider implements TerminalProvider {
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
    command?: { command: string; args: string[] }
  ): Promise<void> {
    return this.spawnWithPolicy(terminal, initialSize, command, {
      respawnOnExit: true,
      preserveBufferOnExit: false,
      watchDevServer: true,
      trackForRehydrate: true,
    });
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
      }
    );
  }

  private spawnWithPolicy(
    terminal: Terminal,
    initialSize: { cols: number; rows: number },
    command: { command: string; args: string[] } | undefined,
    policy: SpawnPolicy
  ): Promise<void> {
    const sessionId = makePtySessionId(terminal.projectId, terminal.taskId, terminal.id);
    this.knownSessionIds.add(sessionId);
    if (policy.trackForRehydrate) {
      this.terminals.set(terminal.id, terminal);
    }
    this.clearRespawnTimer(sessionId);
    if (this.sessions.has(sessionId)) return Promise.resolve();

    const existing = this.startOperations.get(sessionId);
    if (existing?.promise) return existing.promise;

    const operation: StartOperation = { token: Symbol(sessionId) };
    this.startOperations.set(sessionId, operation);
    const promise = this.runStartOperation(
      sessionId,
      terminal,
      initialSize,
      command,
      policy,
      operation
    );
    operation.promise = promise.finally(() => {
      if (this.isCurrentStart(sessionId, operation)) {
        this.startOperations.delete(sessionId);
      }
    });
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
      const result = await openSsh2Pty(this.proxy.client, {
        id: sessionId,
        command: sshCommand,
        cols: initialSize.cols,
        rows: initialSize.rows,
      });

      if (!this.isCurrentStart(sessionId, operation)) {
        if (result.success) {
          this.rollbackSpawnedPty(sessionId, result.data, operation);
        }
        return;
      }
      if (!result.success) {
        log.error('SshTerminalProvider: failed to open SSH channel', {
          sessionId,
          error: result.error.message,
        });
        return;
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
        this.rollbackSpawnedPty(sessionId, pty, operation);
        return;
      }
      ptySessionRegistry.register(sessionId, pty, {
        preserveBufferOnExit: policy.preserveBufferOnExit,
        registrationEpoch,
        tmuxBacked: Boolean(tmuxSessionName),
      });
      registrationCompleted = true;
      if (!this.isCurrentStart(sessionId, operation)) {
        this.rollbackSpawnedPty(sessionId, pty, operation);
        return;
      }
      if (this.sessions.get(sessionId) === pty && tmuxSessionName) {
        this.tmuxSessionNames.set(sessionId, tmuxSessionName);
      }
      spawnedPty = undefined;
    } catch (error) {
      if (spawnedPty) {
        this.rollbackSpawnedPty(sessionId, spawnedPty, operation);
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

  private invalidateStart(sessionId: string): StartOperation | undefined {
    const operation = this.startOperations.get(sessionId);
    if (!operation) return undefined;
    this.startOperations.delete(sessionId);
    if (operation.registrationEpoch !== undefined) {
      ptySessionRegistry.cancelRegistration(sessionId, operation.registrationEpoch);
    }
    return operation;
  }

  private rollbackSpawnedPty(sessionId: string, pty: Pty, operation: StartOperation): void {
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
    const terminals = Array.from(this.terminals.values());
    const operation = Promise.all(
      terminals.map(async (terminal) => {
        const sessionId = makePtySessionId(terminal.projectId, terminal.taskId, terminal.id);
        if (this.sessions.has(sessionId)) return;
        await this.spawnTerminal(terminal).catch((e) => {
          log.error('SshTerminalProvider: rehydrate failed', {
            terminalId: terminal.id,
            error: String(e),
          });
        });
      })
    ).then(() => undefined);
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
    sshConnectionManager.off('connection-event', this._handleReconnect);
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
