import { eq, sql } from 'drizzle-orm';
import type { MoveProjectPathParams, Project } from '@shared/projects';
import { GitHubAuthExecutionContext } from '@main/core/execution-context/github-auth-execution-context';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { GitService } from '@main/core/git/impl/git-service';
import { githubConnectionService } from '@main/core/github/services/github-connection-service';
import { projectManager } from '@main/core/projects/project-manager';
import { sshConnectionManager } from '@main/core/ssh/ssh-connection-manager';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { checkIsValidDirectory } from '../path-utils';
import { resolveProjectBaseRef } from './create-project-utils';
import { syncAgentProjectPathArtifacts } from './sync-agent-project-path-artifacts';

type ProjectRow = typeof projects.$inferSelect;

type ResolvedMoveTarget = {
  rootPath: string;
  baseRef: string;
};

export async function moveProjectPath(
  projectId: string,
  params: MoveProjectPathParams
): Promise<Project> {
  const name = params.name.trim();
  const requestedPath = params.path.trim();

  if (!name) throw new Error('Project name is required');
  if (!requestedPath) throw new Error('Project path is required');

  const [row] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!row) throw new Error(`Project ${projectId} not found`);
  if (row.isInternal === 1) throw new Error('Internal projects cannot be moved');

  const target =
    row.workspaceProvider === 'ssh'
      ? await resolveSshTarget(requestedPath, row.sshConnectionId)
      : await resolveLocalTarget(requestedPath);

  const [existing] = await db
    .select()
    .from(projects)
    .where(eq(projects.path, target.rootPath))
    .limit(1);

  if (existing && existing.id !== projectId) {
    throw new Error(`A project at ${target.rootPath} already exists.`);
  }

  if (
    row.name === name &&
    row.path === target.rootPath &&
    (row.baseRef ?? 'main') === target.baseRef
  ) {
    return mapProjectRow(row);
  }

  const closeResult = await projectManager.closeProject(projectId, { mode: 'detach' });
  if (!closeResult.success) {
    log.warn('moveProjectPath: closeProject failed', {
      projectId,
      error: closeResult.error.message,
    });
  }

  const [updated] = await db
    .update(projects)
    .set({
      name,
      path: target.rootPath,
      baseRef: target.baseRef,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(projects.id, projectId))
    .returning();
  if (!updated) throw new Error(`Project ${projectId} not found`);

  if (row.path !== target.rootPath) {
    await syncAgentProjectPathArtifacts(row.path, target.rootPath);
  }

  return mapProjectRow(updated);
}

async function resolveLocalTarget(path: string): Promise<ResolvedMoveTarget> {
  if (!checkIsValidDirectory(path)) {
    throw new Error('Invalid directory');
  }

  const fs = new LocalFileSystem(path);
  const baseCtx = new LocalExecutionContext({ root: path });
  const authCtx = new GitHubAuthExecutionContext(baseCtx, () => githubConnectionService.getToken());
  const git = new GitService(baseCtx, authCtx, fs);
  const gitInfo = await git.detectInfo();
  if (!gitInfo.isGitRepo) throw new Error('Directory is not a git repository');
  return {
    rootPath: gitInfo.rootPath,
    baseRef: await resolveProjectBaseRef(git, gitInfo.baseRef),
  };
}

async function resolveSshTarget(
  path: string,
  connectionId: string | null
): Promise<ResolvedMoveTarget> {
  if (!connectionId) throw new Error('SSH connection is required');

  const sshProxy = await sshConnectionManager.connect(connectionId);
  const fs = new SshFileSystem(sshProxy, path);
  const pathEntry = await fs.stat('');
  if (!pathEntry || pathEntry.type !== 'dir') {
    throw new Error('Invalid directory');
  }

  const baseCtx = new SshExecutionContext(sshProxy, { root: path });
  const authCtx = new GitHubAuthExecutionContext(baseCtx, () => githubConnectionService.getToken());
  const git = new GitService(baseCtx, authCtx, fs);
  const gitInfo = await git.detectInfo();
  if (!gitInfo.isGitRepo) throw new Error('Directory is not a git repository');
  return {
    rootPath: gitInfo.rootPath,
    baseRef: await resolveProjectBaseRef(git, gitInfo.baseRef),
  };
}

function mapProjectRow(row: ProjectRow): Project {
  if (row.workspaceProvider === 'local') {
    return {
      type: 'local',
      id: row.id,
      name: row.name,
      alias: row.alias,
      path: row.path,
      baseRef: row.baseRef ?? 'main',
      workspaceId: row.workspaceId ?? null,
      isInternal: row.isInternal === 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  return {
    type: 'ssh',
    id: row.id,
    name: row.name,
    alias: row.alias,
    path: row.path,
    baseRef: row.baseRef ?? 'main',
    connectionId: row.sshConnectionId!,
    workspaceId: row.workspaceId ?? null,
    isInternal: row.isInternal === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
