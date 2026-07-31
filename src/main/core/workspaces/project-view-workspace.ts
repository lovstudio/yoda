import { GitHubAuthExecutionContext } from '@main/core/execution-context/github-auth-execution-context';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { GitService } from '@main/core/git/impl/git-service';
import { githubConnectionService } from '@main/core/github/services/github-connection-service';
import type { ProjectProvider } from '@main/core/projects/project-provider';
import type { Workspace } from '@main/core/workspaces/workspace';
import { buildTaskProviders } from '@main/core/workspaces/workspace-factory';
import { projectViewWorkspaceId } from '@main/core/workspaces/workspace-id';
import { LifecycleScriptService } from '@main/core/workspaces/workspace-lifecycle-service';
import {
  workspaceRegistry,
  type WorkspaceFactoryResult,
} from '@main/core/workspaces/workspace-registry';

/**
 * Acquires the project-view workspace: a slim workspace on the project root
 * that backs project-level file tabs (read/edit files outside any task).
 *
 * Unlike task workspaces it runs NO lifecycle scripts and owns no fetch
 * service — it reuses the project-level git singletons. Refcounted via the
 * workspace registry, so repeated acquires are cheap.
 */
export async function acquireProjectViewWorkspace(provider: ProjectProvider): Promise<Workspace> {
  const type = provider.defaultWorkspaceType;
  const workspaceId = projectViewWorkspaceId(type.kind, provider.projectId);

  return workspaceRegistry.acquire(
    workspaceId,
    provider.projectId,
    createProjectViewWorkspaceFactory(workspaceId, provider)
  );
}

export function projectViewWorkspaceIdForProvider(provider: ProjectProvider): string {
  return projectViewWorkspaceId(provider.defaultWorkspaceType.kind, provider.projectId);
}

export async function releaseProjectViewWorkspace(provider: ProjectProvider): Promise<void> {
  const workspaceId = projectViewWorkspaceId(
    provider.defaultWorkspaceType.kind,
    provider.projectId
  );
  await workspaceRegistry.release(workspaceId, 'detach');
}

function createProjectViewWorkspaceFactory(
  workspaceId: string,
  provider: ProjectProvider
): () => Promise<WorkspaceFactoryResult> {
  return async () => {
    const type = provider.defaultWorkspaceType;
    const workDir = provider.repoPath;

    const workspaceFs =
      type.kind === 'ssh' ? new SshFileSystem(type.proxy, workDir) : new LocalFileSystem(workDir);

    const baseGitCtx =
      type.kind === 'ssh'
        ? new SshExecutionContext(type.proxy, { root: workDir })
        : new LocalExecutionContext({ root: workDir });
    const authGitCtx = new GitHubAuthExecutionContext(baseGitCtx, () =>
      githubConnectionService.getToken()
    );
    const gitService = new GitService(baseGitCtx, authGitCtx, workspaceFs);

    // Inert terminal provider — only present to satisfy LifecycleScriptService;
    // the project-view workspace never runs lifecycle scripts.
    const { terminals } = buildTaskProviders(type, {
      projectId: provider.projectId,
      taskId: workspaceId,
      taskPath: workDir,
      tmuxEnabled: false,
      taskEnvVars: {},
    });

    const workspace: Workspace = {
      id: workspaceId,
      path: workDir,
      fs: workspaceFs,
      git: gitService,
      settings: provider.settings,
      lifecycleService: new LifecycleScriptService({
        projectId: provider.projectId,
        workspaceId,
        terminals,
      }),
      terminals,
      repository: provider.repository,
      fetchService: provider.gitFetchService,
    };

    return { workspace };
  };
}
