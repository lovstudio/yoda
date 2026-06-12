import fs from 'node:fs';
import path from 'node:path';
import { safePathSegment } from '@shared/path-name';
import type { LocalProject, SshProject } from '@shared/projects';
import { GitHubAuthExecutionContext } from '@main/core/execution-context/github-auth-execution-context';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import { GitFetchService } from '@main/core/git/git-fetch-service';
import { GitService } from '@main/core/git/impl/git-service';
import { GitRepositoryService } from '@main/core/git/repository-service';
import { githubConnectionService } from '@main/core/github/services/github-connection-service';
import {
  sshConnectionManager,
  type SshConnectionEvent,
} from '@main/core/ssh/ssh-connection-manager';
import { log } from '@main/lib/logger';
import { ProjectProvider, type ProjectProviderTransport } from './project-provider';
import type { ProjectSettingsProvider } from './settings/provider';
import { LocalProjectSettingsProvider } from './settings/providers/local-project-settings-provider';
import { SshProjectSettingsProvider } from './settings/providers/ssh-project-settings-provider';
import { LocalWorktreeHost } from './worktrees/hosts/local-worktree-host';
import { SshWorktreeHost } from './worktrees/hosts/ssh-worktree-host';
import type { WorktreeHost } from './worktrees/hosts/worktree-host';
import { WorktreeService } from './worktrees/worktree-service';

const hasGitHubToken = async (): Promise<boolean> =>
  (await githubConnectionService.getToken()) !== null;

/** The per-project name bucket inside the pool only matters when multiple
 *  projects share one pool root (e.g. ~/Yoda/worktrees). A pool inside the
 *  project itself (.worktrees, .yoda/worktrees) is already project-scoped. */
function isInsideProject(worktreeDirectory: string, projectPath: string, sep: string): boolean {
  return worktreeDirectory.startsWith(projectPath + sep);
}

/** When the worktree directory lives inside the project, keep it out of git
 *  status via `.git/info/exclude` (local-only, never touches tracked files). */
async function ensureWorktreeDirectoryExcluded(
  projectPath: string,
  worktreeDirectory: string
): Promise<void> {
  const rel = path.relative(projectPath, worktreeDirectory);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return;
  try {
    // `.git` may be a file (the project itself is a worktree/submodule); only
    // handle the plain-directory case and skip otherwise.
    const gitDir = path.join(projectPath, '.git');
    if (!(await fs.promises.stat(gitDir)).isDirectory()) return;
    const excludePath = path.join(gitDir, 'info', 'exclude');
    const entry = `/${rel.split(path.sep).join('/')}/`;
    const existing = await fs.promises.readFile(excludePath, 'utf8').catch(() => '');
    if (existing.split(/\r?\n/).includes(entry)) return;
    await fs.promises.mkdir(path.dirname(excludePath), { recursive: true });
    const prefix = existing && !existing.endsWith('\n') ? `${existing}\n` : existing;
    await fs.promises.writeFile(excludePath, `${prefix}${entry}\n`);
  } catch (error) {
    log.warn('ensureWorktreeDirectoryExcluded: failed', {
      projectPath,
      worktreeDirectory,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createProvider(project: LocalProject | SshProject): Promise<ProjectProvider> {
  if (project.type === 'ssh') {
    return createSshProvider(project);
  }
  return createLocalProvider(project);
}

async function createLocalProvider(project: LocalProject): Promise<ProjectProvider> {
  const localFs = new LocalFileSystem(project.path);
  const baseCtx = new LocalExecutionContext({ root: project.path });
  const authCtx = new GitHubAuthExecutionContext(baseCtx, () => githubConnectionService.getToken());
  const ctx = baseCtx;

  const settings = new LocalProjectSettingsProvider(project.id, project.path, project.baseRef);
  const worktreeDirectory = await settings.getWorktreeDirectory();
  await fs.promises.mkdir(worktreeDirectory, { recursive: true });
  await ensureWorktreeDirectoryExcluded(project.path, worktreeDirectory);
  const worktreePoolPath = isInsideProject(worktreeDirectory, project.path, path.sep)
    ? worktreeDirectory
    : path.join(worktreeDirectory, safePathSegment(project.name, project.id));
  const worktreeHost = await LocalWorktreeHost.create({
    allowedRoots: [project.path, worktreeDirectory],
  });

  return buildProvider(
    project.id,
    project.path,
    { kind: 'local', defaultWorkspaceType: { kind: 'local' }, ctx, authCtx },
    localFs,
    settings,
    worktreeHost,
    worktreePoolPath,
    () => {}
  );
}

async function createSshProvider(project: SshProject): Promise<ProjectProvider> {
  try {
    const proxy = await sshConnectionManager.connect(project.connectionId);
    const rootFs = new SshFileSystem(proxy, '/');
    const projectFs = new SshFileSystem(proxy, project.path);

    const baseCtx = new SshExecutionContext(proxy, { root: project.path });
    const authCtx = new GitHubAuthExecutionContext(baseCtx, () =>
      githubConnectionService.getToken()
    );
    const ctx = baseCtx;

    const settings = new SshProjectSettingsProvider(
      project.id,
      projectFs,
      project.baseRef,
      rootFs,
      project.path,
      baseCtx
    );
    const sshWorktreeDirectory = await settings.getWorktreeDirectory();
    const worktreePoolPath = isInsideProject(sshWorktreeDirectory, project.path, '/')
      ? sshWorktreeDirectory
      : path.posix.join(sshWorktreeDirectory, project.name);
    const worktreeHost = new SshWorktreeHost(rootFs);
    await worktreeHost.mkdirAbsolute(worktreePoolPath, { recursive: true });

    const dispose = () => sshConnectionManager.off('connection-event', handler);

    const provider = buildProvider(
      project.id,
      project.path,
      {
        kind: 'ssh',
        defaultWorkspaceType: { kind: 'ssh', proxy, connectionId: project.connectionId },
        ctx,
        authCtx,
      },
      projectFs,
      settings,
      worktreeHost,
      worktreePoolPath,
      dispose
    );

    // Wire reconnect handler after provider is built so gitFetchService is available.
    const handler = (evt: SshConnectionEvent) => {
      if (evt.type === 'reconnected' && evt.connectionId === project.connectionId) {
        void provider.gitFetchService.fetch();
      }
    };
    sshConnectionManager.on('connection-event', handler);

    return provider;
  } catch (error) {
    log.warn('createSshProvider: SSH connection failed', {
      projectId: project.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function buildProvider(
  projectId: string,
  repoPath: string,
  transportMeta: Pick<
    ProjectProviderTransport,
    'kind' | 'defaultWorkspaceType' | 'ctx' | 'authCtx'
  >,
  projectFs: FileSystemProvider,
  settings: ProjectSettingsProvider,
  worktreeHost: WorktreeHost,
  worktreePoolPath: string,
  dispose: () => void
): ProjectProvider {
  const { ctx, authCtx } = transportMeta;

  const transport: ProjectProviderTransport = {
    ...transportMeta,
    fs: projectFs,
    settings,
    worktreeHost,
    worktreePoolPath,
  };

  const repoGit = new GitService(ctx, authCtx, projectFs);
  const repository = new GitRepositoryService(repoGit, settings);
  const worktreeService = new WorktreeService({
    worktreePoolPath,
    repoPath,
    projectSettings: settings,
    ctx,
    host: worktreeHost,
  });
  const gitFetchService = new GitFetchService(repoGit, hasGitHubToken);
  gitFetchService.start();

  return new ProjectProvider(
    projectId,
    repoPath,
    transport,
    repository,
    worktreeService,
    gitFetchService,
    dispose
  );
}
