import { computed, makeAutoObservable, observable, runInAction } from 'mobx';
import { getRuntime, type RuntimeId } from '@shared/runtime-registry';
import {
  GLOBAL_TERMINAL_PROJECT_ID,
  GLOBAL_TERMINAL_SCOPE_ID,
  projectTerminalScopeId,
  type WorkspaceTerminalAction,
} from '@shared/terminals';
import type { MountedProject } from '@renderer/features/projects/stores/project';
import {
  TerminalManagerStore,
  workspaceTerminalGateway,
} from '@renderer/features/tasks/terminals/terminal-manager';
import { TerminalTabViewStore } from '@renderer/features/tasks/terminals/terminal-tab-view-store';
import { getTerminalsPaneSize } from '@renderer/features/tasks/terminals/terminal-tabs';
import { rpc } from '@renderer/lib/ipc';

const WORKSPACE_TERMINAL_PANE_ID = 'workspace-terminal';
export const WORKSPACE_TERMINAL_SCOPE_LIMIT = 16;

class WorkspaceTerminalScopeStore {
  readonly manager: TerminalManagerStore;
  readonly tabs: TerminalTabViewStore;

  constructor(
    readonly projectId: string,
    readonly scopeId: string,
    readonly sourceProjectId: string | null
  ) {
    this.manager = new TerminalManagerStore(projectId, scopeId, workspaceTerminalGateway);
    this.tabs = new TerminalTabViewStore(this.manager);
  }

  dispose(): void {
    this.tabs.dispose();
    this.manager.dispose();
  }
}

export class WorkspaceTerminalStore {
  isOpen = false;
  error: string | null = null;
  activeScope: WorkspaceTerminalScopeStore | null = null;
  private followsActiveProject = false;
  private readonly scopes = new Map<string, WorkspaceTerminalScopeStore>();

  constructor() {
    makeAutoObservable<this, 'scopes'>(this, {
      activeScope: observable.ref,
      scopes: false,
      manager: computed,
      tabs: computed,
      activeProjectId: computed,
    });
  }

  get manager(): TerminalManagerStore | null {
    return this.activeScope?.manager ?? null;
  }

  get tabs(): TerminalTabViewStore | null {
    return this.activeScope?.tabs ?? null;
  }

  get activeProjectId(): string | null {
    return this.activeScope?.sourceProjectId ?? null;
  }

  async toggleProject(project: MountedProject['data']): Promise<void> {
    const scopeId = projectTerminalScopeId(project.type, project.id);
    if (this.isOpen && this.activeScope?.scopeId === scopeId) {
      this.close();
      return;
    }
    await this.openProject(project);
  }

  async openProject(
    project: MountedProject['data'],
    options: { ensureTerminal?: boolean } = {}
  ): Promise<void> {
    this.followsActiveProject = true;
    const scopeId = projectTerminalScopeId(project.type, project.id);
    const scope = this.getOrCreateScope(project.id, scopeId, project.id);
    await this.openScope(scope, options.ensureTerminal ?? true);
  }

  async toggleGlobal(): Promise<void> {
    if (this.isOpen && this.activeScope?.scopeId === GLOBAL_TERMINAL_SCOPE_ID) {
      this.close();
      return;
    }
    await this.openGlobal();
  }

  async openGlobal(options: { ensureTerminal?: boolean } = {}): Promise<void> {
    this.followsActiveProject = false;
    const scope = this.getOrCreateScope(GLOBAL_TERMINAL_PROJECT_ID, GLOBAL_TERMINAL_SCOPE_ID, null);
    await this.openScope(scope, options.ensureTerminal ?? true);
  }

  async syncActiveProject(project: MountedProject['data'] | null): Promise<void> {
    if (!this.isOpen || !this.followsActiveProject) return;
    if (!project) {
      this.close();
      return;
    }
    const scopeId = projectTerminalScopeId(project.type, project.id);
    if (this.activeScope?.scopeId === scopeId) return;
    await this.openProject(project, { ensureTerminal: false });
  }

  async runCommand(project: MountedProject['data'], command: string, label: string): Promise<void> {
    const normalizedCommand = command.trim();
    if (!normalizedCommand) throw new Error('The quick action command is empty.');
    if (normalizedCommand.length > 32_000) {
      throw new Error('The quick action command is too long.');
    }

    await this.openProject(project, { ensureTerminal: false });
    const scope = this.activeScope;
    if (!scope) throw new Error('The project Terminal is unavailable.');
    const terminal = await scope.manager.createCommandTerminal({
      command: normalizedCommand,
      label,
      initialSize: getTerminalsPaneSize(WORKSPACE_TERMINAL_PANE_ID),
    });
    scope.tabs.setActiveTab(terminal.id);
  }

  async runRuntimeAction(runtimeId: RuntimeId, action: WorkspaceTerminalAction): Promise<void> {
    await this.openGlobal({ ensureTerminal: false });
    const scope = this.activeScope;
    if (!scope) throw new Error('The runtime Terminal is unavailable.');
    const runtimeName = getRuntime(runtimeId)?.name ?? runtimeId;
    const terminal = await scope.manager.createNamedTerminal({
      label: runtimeName,
      initialSize: getTerminalsPaneSize(WORKSPACE_TERMINAL_PANE_ID),
    });
    scope.tabs.setActiveTab(terminal.id);
    await rpc.terminals.runWorkspaceRuntimeAction(terminal.id, { runtimeId, action });
  }

  async createTerminal(): Promise<void> {
    const scope = this.activeScope;
    if (!scope) return;
    const terminal = await scope.manager.createDefaultTerminal();
    scope.tabs.setActiveTab(terminal.id);
  }

  close(): void {
    this.isOpen = false;
  }

  dispose(): void {
    const retainedScopes = [...this.scopes.values()];
    this.scopes.clear();
    this.activeScope = null;
    this.isOpen = false;
    this.error = null;
    this.followsActiveProject = false;
    for (const scope of retainedScopes) scope.dispose();
  }

  private async openScope(scope: WorkspaceTerminalScopeStore, ensureTerminal: boolean) {
    runInAction(() => {
      this.activeScope = scope;
      this.isOpen = true;
      this.error = null;
    });
    try {
      await scope.manager.load();
      if (ensureTerminal && scope.tabs.tabs.length === 0) {
        const terminal = await scope.manager.ensureDefaultTerminal();
        scope.tabs.setActiveTab(terminal.id);
      }
    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : String(error);
      });
      throw error;
    }
  }

  private getOrCreateScope(
    projectId: string,
    scopeId: string,
    sourceProjectId: string | null
  ): WorkspaceTerminalScopeStore {
    const key = `${projectId}\0${scopeId}`;
    const existing = this.scopes.get(key);
    if (existing) {
      this.scopes.delete(key);
      this.scopes.set(key, existing);
      return existing;
    }
    const scope = new WorkspaceTerminalScopeStore(projectId, scopeId, sourceProjectId);
    this.scopes.set(key, scope);
    this.evictLeastRecentlyUsedScopes(scope);
    return scope;
  }

  private evictLeastRecentlyUsedScopes(newScope: WorkspaceTerminalScopeStore): void {
    while (this.scopes.size > WORKSPACE_TERMINAL_SCOPE_LIMIT) {
      let candidate: [string, WorkspaceTerminalScopeStore] | undefined;
      for (const entry of this.scopes) {
        const [, scope] = entry;
        if (scope === this.activeScope || scope === newScope) continue;
        candidate = entry;
        break;
      }
      if (!candidate) return;
      const [key, scope] = candidate;
      this.scopes.delete(key);
      scope.dispose();
    }
  }
}

export const workspaceTerminalStore = new WorkspaceTerminalStore();
