import type { Branch, FetchError, InitialCommitPreview } from '@shared/git';
import type { ProjectRemoteState } from '@shared/projects';
import type { Result } from '@shared/result';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { FileSystemProvider } from '@main/core/fs/types';
import type { GitFetchService } from '@main/core/git/git-fetch-service';
import type { GitRepositoryService } from '@main/core/git/repository-service';
import { appSettingsService } from '@main/core/settings/settings-service';
import { workspaceRegistry, type TeardownMode } from '@main/core/workspaces/workspace-registry';
import type { IDisposable } from '@main/lib/lifecycle';
import type { ConversationProvider } from '../conversations/types';
import { taskManager } from '../tasks/task-manager';
import type { TerminalProvider } from '../terminals/terminal-provider';
import type { WorkspaceType } from '../workspaces/workspace-factory';
import type { ProjectSettingsProvider } from './settings/provider';
import type { WorktreeHost } from './worktrees/hosts/worktree-host';
import type { WorktreeService } from './worktrees/worktree-service';

export type WorkspaceProviderData = {
  provisionCommand: string;
  terminateCommand: string;
  remoteWorkspaceId?: string;
};

export type ProvisionResult = {
  taskProvider: TaskProvider;
  persistData: {
    workspaceId: string;
    workspaceProviderData?: WorkspaceProviderData;
    sshConnectionId?: string;
    worktreeGitDir?: string;
  };
};

export type ProjectDisposeMode = TeardownMode | 'project-settings';

export type ProjectDisposeOptions = {
  mode?: ProjectDisposeMode;
};

export interface TaskProvider {
  readonly taskId: string;
  readonly taskBranch: string | undefined;
  readonly sourceBranch: Branch | undefined;
  readonly taskEnvVars: Record<string, string>;
  readonly conversations: ConversationProvider;
  readonly terminals: TerminalProvider;
}

/**
 * Transport-specific dependencies: the only things that differ between local and SSH.
 * Pure data — no lifecycle methods.
 */
export type ProjectProviderTransport = {
  readonly kind: string;
  readonly defaultWorkspaceType: WorkspaceType;
  readonly ctx: IExecutionContext;
  readonly authCtx: IExecutionContext;
  readonly fs: FileSystemProvider;
  readonly settings: ProjectSettingsProvider;
  readonly worktreeHost: WorktreeHost;
  readonly worktreePoolPath: string;
};

export class ProjectProvider implements IDisposable {
  readonly type: string;
  readonly projectId: string;
  readonly repoPath: string;
  readonly settings: ProjectSettingsProvider;
  readonly repository: GitRepositoryService;
  readonly fs: FileSystemProvider;
  readonly worktreeService: WorktreeService;
  readonly gitFetchService: GitFetchService;
  /** Workspace type for standard worktree tasks. BYOI tasks use their own remote workspace type. */
  readonly defaultWorkspaceType: WorkspaceType;

  private readonly _ctx: IExecutionContext;

  constructor(
    projectId: string,
    repoPath: string,
    transport: ProjectProviderTransport,
    repository: GitRepositoryService,
    worktreeService: WorktreeService,
    gitFetchService: GitFetchService,
    private readonly _dispose: () => void
  ) {
    this.type = transport.kind;
    this.projectId = projectId;
    this.repoPath = repoPath;
    this._ctx = transport.ctx;
    this.settings = transport.settings;
    this.fs = transport.fs;
    this.repository = repository;
    this.worktreeService = worktreeService;
    this.gitFetchService = gitFetchService;
    this.defaultWorkspaceType = transport.defaultWorkspaceType;
  }

  get ctx(): IExecutionContext {
    return this._ctx;
  }

  getRemoteState(): Promise<ProjectRemoteState> {
    return this.repository.getRemoteState();
  }

  getWorktreeForBranch(branchName: string): Promise<string | undefined> {
    return this.worktreeService.getWorktree(branchName);
  }

  async removeTaskWorktree(taskBranch: string): Promise<void> {
    const worktreePath = await this.worktreeService.getWorktree(taskBranch);
    if (worktreePath) {
      await this.worktreeService.removeWorktree(worktreePath);
    }
  }

  fetch(): Promise<Result<void, FetchError>> {
    return this.gitFetchService.fetch();
  }

  /**
   * Preview what `git add -A` would commit for an unborn repo's first commit.
   * Lets the UI warn before committing a directory that may contain a huge,
   * un-ignored payload (e.g. node_modules). Size is sampled to stay bounded and
   * is only computed for local projects (avoids thousands of SSH round-trips).
   */
  async getInitialCommitPreview(): Promise<InitialCommitPreview> {
    const { stdout } = await this._ctx.exec('git', [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
    ]);
    const files = stdout.split('\0').filter(Boolean);
    const fileCount = files.length;

    if (!this._ctx.supportsLocalSpawn || fileCount === 0) {
      return { fileCount, totalBytes: fileCount === 0 ? 0 : null, approximate: false };
    }

    const SAMPLE_CAP = 2000;
    const sample = files.slice(0, SAMPLE_CAP);
    const sizes = await Promise.all(
      sample.map((path) =>
        this.fs
          .stat(path)
          .then((entry) => entry?.size ?? 0)
          .catch(() => 0)
      )
    );
    const sampledBytes = sizes.reduce((sum, size) => sum + size, 0);
    const approximate = fileCount > SAMPLE_CAP;
    const totalBytes = approximate
      ? Math.round((sampledBytes / sample.length) * fileCount)
      : sampledBytes;
    return { fileCount, totalBytes, approximate };
  }

  /**
   * Seed an unborn repo with its first commit so worktree-based flows (compare,
   * team, new-branch) can fork from it. Stages everything (respecting
   * .gitignore) and commits; --allow-empty covers the case where every file is
   * ignored. Falls back to a Yoda identity only when git has none configured.
   */
  async createInitialCommit(): Promise<void> {
    await this._ctx.exec('git', ['add', '-A']);
    const email = await this._ctx
      .exec('git', ['config', 'user.email'])
      .then((r) => r.stdout.trim())
      .catch(() => '');
    const identityArgs = email
      ? []
      : ['-c', 'user.name=Yoda', '-c', 'user.email=yoda@lovstudio.ai'];
    await this._ctx.exec('git', [
      ...identityArgs,
      'commit',
      '--allow-empty',
      '-m',
      'Initial commit',
    ]);
  }

  async dispose(options: ProjectDisposeOptions = {}): Promise<void> {
    this._dispose();
    this.gitFetchService.stop();
    const mode = await this.resolveDisposeMode(options.mode ?? 'project-settings');
    await taskManager.teardownAllForProject(this.projectId, mode);
    await workspaceRegistry.releaseAllForProject(this.projectId, mode);
  }

  private async resolveDisposeMode(mode: ProjectDisposeMode): Promise<TeardownMode> {
    if (mode !== 'project-settings') return mode;
    const projectDefaults = await appSettingsService.get('project');
    return projectDefaults.tmuxByDefault ? 'detach' : 'terminate';
  }
}
