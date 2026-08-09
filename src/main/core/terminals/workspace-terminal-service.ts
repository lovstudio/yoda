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
import type { IExecutionContext } from '@main/core/execution-context/types';
import { projectManager } from '@main/core/projects/project-manager';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { argvToInteractiveShellLine } from '@main/core/pty/pty-spawn-platform';
import {
  killTmuxSessionStrict,
  listTmuxSessionMarkersStrict,
  makeTmuxSessionName,
} from '@main/core/pty/tmux-session-name';
import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import { hydratePersistedTerminals } from '@main/core/tasks/terminal-hydration';
import { LocalTerminalProvider } from '@main/core/terminals/impl/local-terminal-provider';
import type { TerminalProvider } from '@main/core/terminals/terminal-provider';
import {
  deletePersistedWorkspaceTerminal,
  getPersistedWorkspaceTerminals,
  persistWorkspaceTerminal,
  renamePersistedWorkspaceTerminal,
} from '@main/core/terminals/workspace-terminal-persistence';
import {
  acquireProjectViewWorkspace,
  projectViewWorkspaceIdForProvider,
} from '@main/core/workspaces/project-view-workspace';
import { workspaceRegistry, type TeardownMode } from '@main/core/workspaces/workspace-registry';
import { log } from '@main/lib/logger';

const MAX_NAME_CHARS = 200;
const ROLLBACK_KILL_TIMEOUT_MS = 2_000;
const PROJECT_TERMINAL_CLEANUP_CONCURRENCY = 4;

class ProjectTerminalCleanupError extends Error {
  constructor(
    message: string,
    readonly errors: readonly unknown[]
  ) {
    super(message);
    this.name = 'ProjectTerminalCleanupError';
  }
}

function withRollbackTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('Workspace terminal rollback timed out.')),
      ROLLBACK_KILL_TIMEOUT_MS
    );
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runCleanupWithConcurrency<T>(
  items: readonly T[],
  cleanup: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const errors: unknown[] = [];
  const workerCount = Math.min(PROJECT_TERMINAL_CLEANUP_CONCURRENCY, items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex++];
        try {
          await cleanup(item);
        } catch (error) {
          errors.push(error);
        }
      }
    })
  );
  if (errors.length > 0) {
    throw new ProjectTerminalCleanupError(
      `Failed to clean up ${errors.length} terminal resource(s).`,
      errors
    );
  }
}

async function killTmuxSessionsWithReconciliation(
  ctx: IExecutionContext,
  sessionNames: readonly string[]
): Promise<void> {
  let nextIndex = 0;
  const killFailures: Array<{ sessionName: string; error: unknown }> = [];
  const workerCount = Math.min(PROJECT_TERMINAL_CLEANUP_CONCURRENCY, sessionNames.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < sessionNames.length) {
        const sessionName = sessionNames[nextIndex++];
        try {
          await killTmuxSessionStrict(ctx, sessionName);
        } catch (error) {
          killFailures.push({ sessionName, error });
        }
      }
    })
  );
  if (killFailures.length === 0) return;

  const remainingSessionNames = new Set(
    (await listTmuxSessionMarkersStrict(ctx)).map((marker) => marker.sessionName)
  );
  const unresolvedFailures = killFailures.filter(({ sessionName }) =>
    remainingSessionNames.has(sessionName)
  );
  if (unresolvedFailures.length > 0) {
    throw new ProjectTerminalCleanupError(
      `Failed to terminate ${unresolvedFailures.length} of ${sessionNames.length} project terminal session(s).`,
      unresolvedFailures.map(({ error }) => error)
    );
  }
}

type WorkspaceTerminalRecord = {
  terminal: Terminal;
  provider: TerminalProvider;
};

export type ActiveWorkspaceTerminalSession = {
  sessionId: string;
  terminalId: string;
  projectId: string;
  scopeId: string;
  name: string;
  detachable: boolean;
};

export type ActiveWorkspaceTerminalSessionSummary = {
  running: number;
  keepable: number;
  nonKeepableSessions: ActiveWorkspaceTerminalSession[];
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
  private readonly loadedScopes = new Set<string>();
  private readonly scopeLoadOperations = new Map<string, Promise<void>>();
  private readonly projectProviders = new Map<string, TerminalProvider>();
  private readonly providerLoadOperations = new Map<string, Promise<TerminalProvider>>();
  private readonly projectScopeIds = new Map<string, Set<string>>();
  private readonly activeProjectOperations = new Map<string, Set<Promise<unknown>>>();
  private readonly projectTerminationOperations = new Map<string, Promise<void>>();
  private readonly blockedProjects = new Set<string>();
  private readonly globalProvider = new LocalTerminalProvider({
    projectId: GLOBAL_TERMINAL_PROJECT_ID,
    scopeId: GLOBAL_TERMINAL_SCOPE_ID,
    taskPath: os.homedir(),
    tmux: false,
    ctx: new LocalExecutionContext({ root: os.homedir() }),
    taskEnvVars: {},
  });

  async getTerminals(projectId: string, scopeId: string): Promise<Terminal[]> {
    return this.runProjectOperation(projectId, async () => {
      const provider = await this.resolveProvider(projectId, scopeId);
      await this.ensureScopeLoaded(projectId, scopeId, provider);
      return Array.from(this.records.values())
        .map(({ terminal }) => terminal)
        .filter((terminal) => terminal.projectId === projectId && terminal.taskId === scopeId);
    });
  }

  async createTerminal(params: CreateTerminalParams): Promise<Terminal> {
    requireTerminalIdentity(params);
    return this.runProjectOperation(params.projectId, async () => {
      const existing = this.records.get(params.id);
      if (existing) return existing.terminal;

      const provider = await this.resolveProvider(params.projectId, params.taskId);
      let terminal: Terminal = {
        id: params.id,
        projectId: params.projectId,
        taskId: params.taskId,
        name: params.name.trim(),
      };
      const persisted = this.isPersistedProjectScope(params.projectId, params.taskId);
      if (persisted) {
        terminal = await persistWorkspaceTerminal(terminal);
      }
      this.records.set(terminal.id, { terminal, provider });
      try {
        await provider.spawnTerminal(terminal, params.initialSize);
        return terminal;
      } catch (error) {
        this.records.delete(terminal.id);
        const cleanupOperations: Promise<unknown>[] = [
          withRollbackTimeout(Promise.resolve().then(() => provider.killTerminal(terminal.id))),
        ];
        if (persisted) {
          cleanupOperations.push(
            deletePersistedWorkspaceTerminal(terminal.projectId, terminal.taskId, terminal.id)
          );
        }
        const cleanupResults = await Promise.allSettled(cleanupOperations);
        for (const result of cleanupResults) {
          if (result.status === 'rejected') {
            log.warn('WorkspaceTerminalService: failed to roll back terminal creation', {
              terminalId: terminal.id,
              error: String(result.reason),
            });
          }
        }
        throw error;
      }
    });
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
    await this.runProjectOperation(projectId, async () => {
      const record = this.records.get(terminalId);
      if (!record || record.terminal.projectId !== projectId || record.terminal.taskId !== taskId) {
        return;
      }
      this.records.delete(terminalId);
      if (this.isPersistedProjectScope(projectId, taskId)) {
        await deletePersistedWorkspaceTerminal(projectId, taskId, terminalId);
      }
      await record.provider.killTerminal(terminalId);
    });
  }

  async renameTerminal(terminalId: string, name: string): Promise<void> {
    const record = this.records.get(terminalId);
    const normalized = name.trim();
    if (!record || !normalized || normalized.length > MAX_NAME_CHARS) return;
    await this.runProjectOperation(record.terminal.projectId, async () => {
      if (this.records.get(terminalId) !== record) return;
      if (this.isPersistedProjectScope(record.terminal.projectId, record.terminal.taskId)) {
        await renamePersistedWorkspaceTerminal(terminalId, normalized);
      }
      record.terminal.name = normalized;
    });
  }

  getActiveSessionSummary(): ActiveWorkspaceTerminalSessionSummary {
    const sessions = Array.from(this.records.values()).map(({ terminal, provider }) => {
      const sessionId = makePtySessionId(terminal.projectId, terminal.taskId, terminal.id);
      return {
        sessionId,
        terminalId: terminal.id,
        projectId: terminal.projectId,
        scopeId: terminal.taskId,
        name: terminal.name,
        detachable: provider.isTerminalDetachable(terminal.id),
      };
    });
    return {
      running: sessions.length,
      keepable: sessions.filter((session) => session.detachable).length,
      nonKeepableSessions: sessions.filter((session) => !session.detachable),
    };
  }

  async dispose(mode: TeardownMode): Promise<void> {
    const providers = new Set(Array.from(this.records.values()).map(({ provider }) => provider));
    await Promise.all(
      Array.from(providers).map((provider) =>
        mode === 'terminate' ? provider.destroyAll() : provider.detachAll()
      )
    );
    await Promise.all(
      Array.from(this.projectProviders.keys()).map((scopeId) =>
        workspaceRegistry.release(scopeId, mode)
      )
    );
    this.records.clear();
    this.loadedScopes.clear();
    this.scopeLoadOperations.clear();
    this.projectProviders.clear();
    this.providerLoadOperations.clear();
    this.projectScopeIds.clear();
    this.activeProjectOperations.clear();
    this.projectTerminationOperations.clear();
    this.blockedProjects.clear();
  }

  /**
   * Permanently terminates every task-free terminal owned by a project.
   * New terminal operations remain blocked after a failed cleanup so callers
   * can safely retry without allowing a late session to escape reclamation.
   */
  async terminateProject(projectId: string): Promise<void> {
    if (projectId === GLOBAL_TERMINAL_PROJECT_ID) return;
    const existing = this.projectTerminationOperations.get(projectId);
    if (existing) return existing;

    this.blockedProjects.add(projectId);
    let completed = false;
    const operation = this.terminateProjectResources(projectId)
      .then(() => {
        completed = true;
      })
      .finally(() => {
        if (this.projectTerminationOperations.get(projectId) === operation) {
          this.projectTerminationOperations.delete(projectId);
          if (completed) this.blockedProjects.delete(projectId);
        }
      });
    this.projectTerminationOperations.set(projectId, operation);
    return operation;
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
    this.rememberProjectScope(projectId, scopeId);
    const cached = this.projectProviders.get(scopeId);
    if (cached && workspaceRegistry.get(scopeId)?.terminals === cached) return cached;
    if (cached) {
      this.projectProviders.delete(scopeId);
      this.loadedScopes.delete(`${projectId}\0${scopeId}`);
      for (const [terminalId, record] of this.records) {
        if (record.terminal.projectId === projectId && record.terminal.taskId === scopeId) {
          this.records.delete(terminalId);
        }
      }
    }

    const existingOperation = this.providerLoadOperations.get(scopeId);
    if (existingOperation) return existingOperation;
    const operation = acquireProjectViewWorkspace(project)
      .then((workspace) => {
        this.projectProviders.set(scopeId, workspace.terminals);
        return workspace.terminals;
      })
      .finally(() => {
        if (this.providerLoadOperations.get(scopeId) === operation) {
          this.providerLoadOperations.delete(scopeId);
        }
      });
    this.providerLoadOperations.set(scopeId, operation);
    return operation;
  }

  private isPersistedProjectScope(projectId: string, scopeId: string): boolean {
    return projectId !== GLOBAL_TERMINAL_PROJECT_ID && scopeId !== GLOBAL_TERMINAL_SCOPE_ID;
  }

  private ensureScopeLoaded(
    projectId: string,
    scopeId: string,
    provider: TerminalProvider
  ): Promise<void> {
    if (!this.isPersistedProjectScope(projectId, scopeId)) return Promise.resolve();
    const key = `${projectId}\0${scopeId}`;
    if (this.loadedScopes.has(key)) return Promise.resolve();
    const existing = this.scopeLoadOperations.get(key);
    if (existing) return existing;

    const operation = getPersistedWorkspaceTerminals(projectId, scopeId)
      .then(async (terminals) => {
        const terminalsToHydrate = terminals.filter((terminal) => {
          if (this.records.has(terminal.id)) return false;
          this.records.set(terminal.id, { terminal, provider });
          return true;
        });
        await hydratePersistedTerminals(
          provider,
          terminalsToHydrate,
          'WorkspaceTerminalService: hydrate',
          {
            shouldHydrate: (terminal) => this.records.get(terminal.id)?.provider === provider,
          }
        );
        this.loadedScopes.add(key);
      })
      .finally(() => {
        if (this.scopeLoadOperations.get(key) === operation) {
          this.scopeLoadOperations.delete(key);
        }
      });
    this.scopeLoadOperations.set(key, operation);
    return operation;
  }

  private runProjectOperation<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    if (projectId === GLOBAL_TERMINAL_PROJECT_ID) return operation();
    if (this.blockedProjects.has(projectId)) {
      return Promise.reject(new Error(`Project terminals are being terminated: ${projectId}`));
    }

    const tracked = Promise.resolve()
      .then(operation)
      .finally(() => {
        const active = this.activeProjectOperations.get(projectId);
        active?.delete(tracked);
        if (active?.size === 0) this.activeProjectOperations.delete(projectId);
      });
    const active = this.activeProjectOperations.get(projectId) ?? new Set<Promise<unknown>>();
    active.add(tracked);
    this.activeProjectOperations.set(projectId, active);
    return tracked;
  }

  private rememberProjectScope(projectId: string, scopeId: string): void {
    const scopeIds = this.projectScopeIds.get(projectId) ?? new Set<string>();
    scopeIds.add(scopeId);
    this.projectScopeIds.set(projectId, scopeIds);
  }

  private async terminateProjectResources(projectId: string): Promise<void> {
    const activeOperations = Array.from(this.activeProjectOperations.get(projectId) ?? []);
    await Promise.allSettled(activeOperations);

    const scopeIds = new Set(this.projectScopeIds.get(projectId) ?? []);
    for (const { terminal } of this.records.values()) {
      if (terminal.projectId === projectId) scopeIds.add(terminal.taskId);
    }
    const project = projectManager.getProject(projectId);
    if (!project) {
      throw new Error(`Project runtime is unavailable; terminal cleanup aborted: ${projectId}`);
    }
    scopeIds.add(projectViewWorkspaceIdForProvider(project));

    const persistedByScope = await Promise.all(
      Array.from(scopeIds, async (scopeId) => ({
        scopeId,
        terminals: await getPersistedWorkspaceTerminals(projectId, scopeId),
      }))
    );

    const providers = new Set<TerminalProvider>();
    for (const scopeId of scopeIds) {
      const provider = this.projectProviders.get(scopeId);
      if (provider) providers.add(provider);
      for (const record of this.records.values()) {
        if (record.terminal.projectId === projectId && record.terminal.taskId === scopeId) {
          providers.add(record.provider);
        }
      }
    }
    await runCleanupWithConcurrency(Array.from(providers), (provider) => provider.destroyAll());

    // Provider teardown only knows sessions hydrated in this process. Preserve
    // terminal identity rows for archive/restore, but use them to reclaim cold
    // detached tmux sessions that survived a renderer or app restart.
    const liveTmuxSessionNames = new Set(
      (await listTmuxSessionMarkersStrict(project.ctx)).map((marker) => marker.sessionName)
    );
    const terminalSessionNames = new Set<string>();
    for (const { scopeId, terminals } of persistedByScope) {
      for (const terminal of terminals) {
        terminalSessionNames.add(
          makeTmuxSessionName(makePtySessionId(projectId, scopeId, terminal.id))
        );
      }
    }
    for (const { terminal } of this.records.values()) {
      if (terminal.projectId !== projectId) continue;
      terminalSessionNames.add(
        makeTmuxSessionName(makePtySessionId(projectId, terminal.taskId, terminal.id))
      );
    }
    const coldSessionNames = Array.from(terminalSessionNames).filter((sessionName) =>
      liveTmuxSessionNames.has(sessionName)
    );
    await killTmuxSessionsWithReconciliation(project.ctx, coldSessionNames);

    const acquiredScopes = Array.from(scopeIds).filter((scopeId) =>
      this.projectProviders.has(scopeId)
    );
    await runCleanupWithConcurrency(acquiredScopes, (scopeId) =>
      workspaceRegistry.release(scopeId, 'terminate')
    );

    for (const [terminalId, record] of this.records) {
      if (record.terminal.projectId === projectId) this.records.delete(terminalId);
    }
    const scopeKeyPrefix = `${projectId}\0`;
    for (const key of this.loadedScopes) {
      if (key.startsWith(scopeKeyPrefix)) this.loadedScopes.delete(key);
    }
    for (const key of this.scopeLoadOperations.keys()) {
      if (key.startsWith(scopeKeyPrefix)) this.scopeLoadOperations.delete(key);
    }
    for (const scopeId of scopeIds) {
      this.projectProviders.delete(scopeId);
      this.providerLoadOperations.delete(scopeId);
    }
    this.projectScopeIds.delete(projectId);
  }
}

export const workspaceTerminalService = new WorkspaceTerminalService();
