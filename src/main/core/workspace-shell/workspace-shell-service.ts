import { stat } from 'node:fs/promises';
import os from 'node:os';
import type { RuntimeCustomConfig } from '@shared/app-settings';
import {
  getRuntime,
  getRuntimeAccountProfile,
  getUpdateCommandForRuntime,
  type RuntimeId,
} from '@shared/runtime-registry';
import type {
  StartWorkspaceShellParams,
  WorkspaceShellRuntimeAction,
} from '@shared/workspace-shell';
import {
  normalizeRuntimeModelArgs,
  parseShellWords,
} from '@main/core/conversations/impl/agent-command';
import { getDependencyManager } from '@main/core/dependencies/dependency-manager';
import { spawnLocalPty } from '@main/core/pty/local-pty';
import type { Pty } from '@main/core/pty/pty';
import { buildTerminalEnv } from '@main/core/pty/pty-env';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import {
  logLocalPtySpawnWarnings,
  resolveLocalPtySpawn,
  type PtyCommandSpec,
} from '@main/core/pty/pty-spawn-platform';
import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import { log } from '@main/lib/logger';
import { ensureUserBinDirsInPath } from '@main/utils/userEnv';

const SESSION_PREFIX = 'workspace-shell:';
const DEFAULT_SIZE = { cols: 100, rows: 24 };

type SessionRecord = {
  pty: Pty;
  cwd: string;
  size: { cols: number; rows: number };
};

function assertSessionId(sessionId: string): void {
  if (!sessionId.startsWith(SESSION_PREFIX) || sessionId.length > 200) {
    throw new Error('Invalid workspace shell session id.');
  }
}

async function resolveCwd(candidate?: string): Promise<string> {
  if (!candidate?.trim()) return os.homedir();
  try {
    const info = await stat(candidate);
    return info.isDirectory() ? candidate : os.homedir();
  } catch {
    return os.homedir();
  }
}

function parseTrustedCommand(command: string): { command: string; args: string[] } {
  const parsed = parseShellWords(command, { rejectShellSyntax: true });
  if (!parsed.ok || !parsed.words[0]) {
    throw new Error(parsed.ok ? 'Runtime command is empty.' : parsed.reason);
  }
  return { command: parsed.words[0], args: parsed.words.slice(1) };
}

function parseFlag(flag: string | undefined): string[] {
  if (!flag) return [];
  const parsed = parseShellWords(flag);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.words;
}

function preferDetectedExecutable(
  runtimeId: RuntimeId,
  command: string,
  detectedPath: string | null
): string {
  if (!detectedPath) return command;
  const runtime = getRuntime(runtimeId);
  const knownCommands = new Set([runtime?.cli, ...(runtime?.commands ?? [])].filter(Boolean));
  return knownCommands.has(command) ? detectedPath : command;
}

export async function resolveRuntimeActionCommand({
  runtimeId,
  action,
}: WorkspaceShellRuntimeAction): Promise<{ command: string; args: string[] }> {
  const runtime = getRuntime(runtimeId);
  if (!runtime) throw new Error(`Unknown runtime: ${runtimeId}`);
  const manager = await getDependencyManager();
  const dependency = manager.get(runtimeId) ?? (await manager.probe(runtimeId));
  if (dependency.status !== 'available') {
    throw new Error(`${runtime.name} is not installed.`);
  }
  const config = await runtimeOverrideSettings.getItem(runtimeId);

  let parsed: { command: string; args: string[] };
  switch (action) {
    case 'open':
      parsed = runtimeOpenCommand(runtimeId, config);
      break;
    case 'update': {
      const command = getUpdateCommandForRuntime(runtimeId);
      if (!command) throw new Error(`${runtime.name} does not expose an update command.`);
      parsed = parseTrustedCommand(command);
      break;
    }
    case 'login': {
      const command = getRuntimeAccountProfile(runtimeId).officialSubscription.loginCommand;
      if (!command) throw new Error(`${runtime.name} does not expose a login command.`);
      parsed = parseTrustedCommand(command);
      break;
    }
    case 'doctor':
      if (runtimeId !== 'codex') {
        throw new Error(`${runtime.name} does not expose an in-app diagnostic command.`);
      }
      parsed = parseTrustedCommand(config?.cli?.trim() || runtime.cli || runtimeId);
      parsed.args.push('doctor');
      break;
  }

  return {
    command: preferDetectedExecutable(runtimeId, parsed.command, dependency.path),
    args: parsed.args,
  };
}

function runtimeOpenCommand(
  runtimeId: RuntimeId,
  config: RuntimeCustomConfig | undefined
): { command: string; args: string[] } {
  const runtime = getRuntime(runtimeId);
  const parsed = parseTrustedCommand(config?.cli?.trim() || runtime?.cli || runtimeId);
  const args = [...parsed.args, ...(config?.defaultArgs ?? []), ...parseFlag(config?.extraArgs)];
  const normalizedArgs = runtime?.modelFlag
    ? normalizeRuntimeModelArgs(
        args,
        runtime.modelFlag,
        config?.defaultModel,
        runtime.modelFlagAliases
      )
    : args;
  return { command: parsed.command, args: normalizedArgs };
}

export class WorkspaceShellService {
  private readonly sessions = new Map<string, SessionRecord>();
  /**
   * Identifies the latest requested lifecycle operation for each renderer
   * session. A Symbol avoids an old awaited start matching a newer start after
   * stop() removed the previous token.
   */
  private readonly operationTokens = new Map<string, symbol>();

  async start(params: StartWorkspaceShellParams): Promise<{ sessionId: string }> {
    assertSessionId(params.sessionId);
    const operationToken = this.beginOperation(params.sessionId);
    const cwd = await resolveCwd(params.cwd);
    if (!this.isCurrentOperation(params.sessionId, operationToken)) {
      return { sessionId: params.sessionId };
    }
    const size = params.initialSize ?? DEFAULT_SIZE;
    this.replace(params.sessionId, cwd, size, operationToken);
    return { sessionId: params.sessionId };
  }

  async execute(
    sessionId: string,
    request: WorkspaceShellRuntimeAction
  ): Promise<{ sessionId: string }> {
    assertSessionId(sessionId);
    const operationToken = this.beginOperation(sessionId);
    const existing = this.sessions.get(sessionId);
    const cwd = existing?.cwd ?? os.homedir();
    const size = existing?.size ?? DEFAULT_SIZE;
    const command = await resolveRuntimeActionCommand(request);
    if (!this.isCurrentOperation(sessionId, operationToken)) return { sessionId };
    this.replace(sessionId, cwd, size, operationToken, { kind: 'argv', ...command }, request);
    return { sessionId };
  }

  stop(sessionId: string): void {
    assertSessionId(sessionId);
    this.operationTokens.delete(sessionId);
    this.stopCurrent(sessionId);
  }

  private beginOperation(sessionId: string): symbol {
    const token = Symbol(sessionId);
    this.operationTokens.set(sessionId, token);
    return token;
  }

  private isCurrentOperation(sessionId: string, token: symbol): boolean {
    return this.operationTokens.get(sessionId) === token;
  }

  private replace(
    sessionId: string,
    cwd: string,
    size: { cols: number; rows: number },
    operationToken: symbol,
    command?: PtyCommandSpec,
    action?: WorkspaceShellRuntimeAction
  ): void {
    if (!this.isCurrentOperation(sessionId, operationToken)) return;
    this.stopCurrent(sessionId);
    const resolved = resolveLocalPtySpawn({
      platform: process.platform,
      env: process.env,
      intent: command ? { kind: 'run-command', cwd, command } : { kind: 'interactive-shell', cwd },
    });
    logLocalPtySpawnWarnings('WorkspaceShellService', resolved.warnings, { sessionId });
    const pty = spawnLocalPty({
      id: sessionId,
      command: resolved.command,
      args: resolved.args,
      cwd: resolved.cwd,
      env: buildTerminalEnv(),
      cols: size.cols,
      rows: size.rows,
    });
    this.sessions.set(sessionId, { pty, cwd, size });

    pty.onExit(({ exitCode }) => {
      if (this.sessions.get(sessionId)?.pty !== pty) return;
      this.sessions.delete(sessionId);
      if (!action) return;
      void this.afterRuntimeAction(action, exitCode).finally(() => {
        setTimeout(() => {
          if (this.isCurrentOperation(sessionId, operationToken) && !this.sessions.has(sessionId)) {
            this.replace(sessionId, cwd, size, operationToken);
          }
        }, 150);
      });
    });
    ptySessionRegistry.register(sessionId, pty, { preserveBufferOnExit: Boolean(action) });
  }

  private stopCurrent(sessionId: string): void {
    const current = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    if (current) {
      try {
        current.pty.kill();
      } catch {}
    }
    ptySessionRegistry.unregister(sessionId);
  }

  private async afterRuntimeAction(
    action: WorkspaceShellRuntimeAction,
    exitCode: number | undefined
  ): Promise<void> {
    if (action.action !== 'update' || exitCode !== 0) return;
    ensureUserBinDirsInPath();
    try {
      const manager = await getDependencyManager();
      await manager.probe(action.runtimeId);
    } catch (error) {
      log.warn('WorkspaceShellService: failed to refresh runtime after update', {
        runtimeId: action.runtimeId,
        error: String(error),
      });
    }
  }
}

export const workspaceShellService = new WorkspaceShellService();
