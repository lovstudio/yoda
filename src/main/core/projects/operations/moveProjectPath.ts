import { eq, sql } from 'drizzle-orm';
import type { MoveProjectPathParams, Project } from '@shared/projects';
import { GitHubAuthExecutionContext } from '@main/core/execution-context/github-auth-execution-context';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { GitService } from '@main/core/git/impl/git-service';
import { githubConnectionService } from '@main/core/github/services/github-connection-service';
import { projectEvents } from '@main/core/projects/project-events';
import { projectManager } from '@main/core/projects/project-manager';
import { prSyncEngine } from '@main/core/pull-requests/pr-sync-engine';
import { sshConnectionManager } from '@main/core/ssh/ssh-connection-manager';
import { viewStateService } from '@main/core/view-state/view-state-service';
import { db, sqlite } from '@main/db/client';
import {
  automations,
  conversations,
  editorBuffers,
  projectRemotes,
  projects,
  projectSettings,
  reviewOrchestrations,
  taskNamingSnapshots,
  tasks,
  teamRooms,
  terminals,
} from '@main/db/schema';
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
    if (params.mergeExistingProjectId !== existing.id) {
      throw new Error(`A project at ${target.rootPath} already exists.`);
    }
    return mergeProjectIntoExisting(row, existing);
  }

  if (
    row.name === name &&
    row.path === target.rootPath &&
    (row.baseRef ?? 'main') === target.baseRef
  ) {
    return mapProjectRow(row);
  }

  await stopProjectAgentsBeforePathChange(projectId, 'move');

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

async function mergeProjectIntoExisting(source: ProjectRow, target: ProjectRow): Promise<Project> {
  if (target.archivedAt) {
    throw new Error('Cannot merge into an archived project');
  }
  if (target.isInternal === 1) {
    throw new Error('Cannot merge into an internal project');
  }
  if (source.workspaceProvider !== target.workspaceProvider) {
    throw new Error('Cannot merge projects with different workspace providers');
  }
  if (source.workspaceProvider === 'ssh' && source.sshConnectionId !== target.sshConnectionId) {
    throw new Error('Cannot merge projects from different SSH connections');
  }

  await stopProjectAgentsBeforePathChange(source.id, 'merge');

  await prSyncEngine.deleteProjectData(source.id);

  const [updatedTarget] = await db.transaction((tx) => {
    tx.update(tasks)
      .set({ projectId: target.id, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(tasks.projectId, source.id));
    tx.update(conversations)
      .set({ projectId: target.id, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(conversations.projectId, source.id));
    tx.update(terminals)
      .set({ projectId: target.id, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(terminals.projectId, source.id));
    tx.update(taskNamingSnapshots)
      .set({ projectId: target.id, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(taskNamingSnapshots.projectId, source.id));
    tx.update(reviewOrchestrations)
      .set({ projectId: target.id, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(reviewOrchestrations.projectId, source.id));
    tx.update(teamRooms)
      .set({ projectId: target.id, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(teamRooms.projectId, source.id));
    tx.update(automations)
      .set({ projectId: target.id, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(automations.projectId, source.id));

    tx.delete(editorBuffers).where(eq(editorBuffers.projectId, source.id));
    tx.delete(projectSettings).where(eq(projectSettings.projectId, source.id));
    tx.delete(projectRemotes).where(eq(projectRemotes.projectId, source.id));
    tx.delete(projects).where(eq(projects.id, source.id));

    return tx
      .update(projects)
      .set({ updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(projects.id, target.id))
      .returning();
  });
  if (!updatedTarget) throw new Error(`Project ${target.id} not found`);

  await syncAgentProjectPathArtifacts(source.path, target.path);
  reassignSearchIndex(source.id, target.id);
  void viewStateService.del(`project:${source.id}`);
  projectEvents._emit('project:deleted', source.id);

  return mapProjectRow(updatedTarget);
}

async function stopProjectAgentsBeforePathChange(
  projectId: string,
  action: 'move' | 'merge'
): Promise<void> {
  const closeResult = await projectManager.closeProject(projectId, { mode: 'terminate' });
  if (closeResult.success) return;

  log.warn('moveProjectPath: failed to stop project agents before path change', {
    projectId,
    action,
    error: closeResult.error.message,
  });
  throw new Error(
    `Failed to stop running agents before project ${action}: ${closeResult.error.message}`
  );
}

function reassignSearchIndex(sourceProjectId: string, targetProjectId: string): void {
  try {
    sqlite
      .prepare(`UPDATE search_index SET project_id = ? WHERE project_id = ?`)
      .run(targetProjectId, sourceProjectId);
    sqlite
      .prepare(`DELETE FROM search_index WHERE item_type = 'project' AND item_id = ?`)
      .run(sourceProjectId);
  } catch (error) {
    log.warn('moveProjectPath: failed to reassign search index during merge', {
      sourceProjectId,
      targetProjectId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
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
