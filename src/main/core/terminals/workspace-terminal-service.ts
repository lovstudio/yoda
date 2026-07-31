import os from 'node:os';
import type { RuntimeCustomConfig } from '@shared/app-settings';
import { makePtySessionId } from '@shared/ptySessionId';
import {
  getRuntime,
  getRuntimeAccountProfile,
  getUpdateCommandForRuntime,
  type RuntimeId,
} from '@shared/runtime-registry';
import {
  GLOBAL_TERMINAL_PROJECT_ID,
  GLOBAL_TERMINAL_SCOPE_ID,
  type CreateTerminalParams,
  type Terminal,
  type WorkspaceTerminalRuntimeAction,
} from '@shared/terminals';
import {
  normalizeRuntimeModelArgs,
  parseShellWords,
} from '@main/core/conversations/impl/agent-command';
import { getDependencyManager } from '@main/core/dependencies/dependency-manager';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { projectManager } from '@main/core/projects/project-manager';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { argvToInteractiveShellLine } from '@main/core/pty/pty-spawn-platform';
import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import { LocalTerminalProvider } from '@main/core/terminals/impl/local-terminal-provider';
import type { TerminalProvider } from '@main/core/terminals/terminal-provider';
import {
  acquireProjectViewWorkspace,
  projectViewWorkspaceIdForProvider,
} from '@main/core/workspaces/project-view-workspace';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';

const MAX_NAME_CHARS = 200;

type WorkspaceTerminalRecord = {
  terminal: Terminal;
  provider: TerminalProvider;
};

function requireTerminalIdentity(params: CreateTerminalParams): void {
  if (!params.id.trim() || params.id.length > 200) {
    throw new Error('Invalid workspace terminal id.');
  }
  if (!params.name.trim() || params.name.length > MAX_NAME_CHARS) {
    throw new Error('Invalid workspace terminal name.');
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

export async function resolveRuntimeActionCommand({
  runtimeId,
  action,
}: WorkspaceTerminalRuntimeAction): Promise<{ command: string; args: string[] }> {
  const runtime = getRuntime(runtimeId);
  if (!runtime) throw new Error(`Unknown runtime: ${runtimeId}`);
  const manager = await getDependencyManager();
  const dependency = manager.get(runtimeId) ?? (await manager.probe(runtimeId));
  if (dependency.status !== 'available') {
    throw new Error(`${runtime.name} is not installed.`);
  }
  const config = await runtimeOverrideSettings.getItem(runtimeId);
  if (config?.disabled && action !== 'update') {
    throw new Error(`${runtime.name} is disabled in Yoda.`);
  }

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

/**
 * Task-free terminals backed by the same TerminalProvider used by task terminals.
 * Project terminals run in the project-view workspace; global terminals run in
 * the user's home directory. Renderer chrome is shared with the task Terminal.
 */
export class WorkspaceTerminalService {
  private readonly records = new Map<string, WorkspaceTerminalRecord>();
  private readonly globalProvider = new LocalTerminalProvider({
    projectId: GLOBAL_TERMINAL_PROJECT_ID,
    scopeId: GLOBAL_TERMINAL_SCOPE_ID,
    taskPath: os.homedir(),
    tmux: false,
    ctx: new LocalExecutionContext({ root: os.homedir() }),
    taskEnvVars: {},
  });

  async getTerminals(projectId: string, scopeId: string): Promise<Terminal[]> {
    await this.resolveProvider(projectId, scopeId);
    return Array.from(this.records.values())
      .map(({ terminal }) => terminal)
      .filter((terminal) => terminal.projectId === projectId && terminal.taskId === scopeId);
  }

  async createTerminal(params: CreateTerminalParams): Promise<Terminal> {
    requireTerminalIdentity(params);
    const existing = this.records.get(params.id);
    if (existing) return existing.terminal;

    const provider = await this.resolveProvider(params.projectId, params.taskId);
    const terminal: Terminal = {
      id: params.id,
      projectId: params.projectId,
      taskId: params.taskId,
      name: params.name.trim(),
    };
    this.records.set(terminal.id, { terminal, provider });
    try {
      await provider.spawnTerminal(terminal, params.initialSize);
      return terminal;
    } catch (error) {
      this.records.delete(terminal.id);
      throw error;
    }
  }

  async deleteTerminal({
    projectId,
    taskId,
    terminalId,
  }: {
    projectId: string;
    taskId: string;
    terminalId: string;
  }): Promise<void> {
    const record = this.records.get(terminalId);
    if (!record || record.terminal.projectId !== projectId || record.terminal.taskId !== taskId) {
      return;
    }
    this.records.delete(terminalId);
    await record.provider.killTerminal(terminalId);
  }

  renameTerminal(terminalId: string, name: string): void {
    const record = this.records.get(terminalId);
    const normalized = name.trim();
    if (!record || !normalized || normalized.length > MAX_NAME_CHARS) return;
    record.terminal.name = normalized;
  }

  async runRuntimeAction(
    terminalId: string,
    request: WorkspaceTerminalRuntimeAction
  ): Promise<void> {
    const record = this.records.get(terminalId);
    if (
      !record ||
      record.terminal.projectId !== GLOBAL_TERMINAL_PROJECT_ID ||
      record.terminal.taskId !== GLOBAL_TERMINAL_SCOPE_ID
    ) {
      throw new Error('The runtime Terminal is unavailable.');
    }
    const command = await resolveRuntimeActionCommand(request);
    const sessionId = makePtySessionId(
      record.terminal.projectId,
      record.terminal.taskId,
      record.terminal.id
    );
    const pty = ptySessionRegistry.get(sessionId);
    if (!pty) throw new Error('The runtime Terminal session is unavailable.');
    pty.write(`${argvToInteractiveShellLine(command.command, command.args)}\r`);
  }

  private async resolveProvider(projectId: string, scopeId: string): Promise<TerminalProvider> {
    if (projectId === GLOBAL_TERMINAL_PROJECT_ID && scopeId === GLOBAL_TERMINAL_SCOPE_ID) {
      return this.globalProvider;
    }

    const project = projectManager.getProject(projectId);
    if (!project) throw new Error('Project not found.');
    const expectedScopeId = projectViewWorkspaceIdForProvider(project);
    if (scopeId !== expectedScopeId) throw new Error('Invalid project Terminal scope.');
    const existing = workspaceRegistry.get(expectedScopeId);
    const workspace = existing ?? (await acquireProjectViewWorkspace(project));
    return workspace.terminals;
  }
}

export const workspaceTerminalService = new WorkspaceTerminalService();
