import { promises as nodeFs } from 'node:fs';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import {
  MAX_PROJECT_ALIAS_LENGTH,
  type MoveProjectPathParams,
  type Project,
} from '@shared/projects';
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
import type { SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
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
import {
  assertProjectMoveTarget,
  localPathExists,
  moveLocalProjectDirectory,
  normalizeLocalProjectPath,
  type MovedProjectDirectory,
} from './move-project-directory';
import { syncAgentProjectPathArtifacts } from './sync-agent-project-path-artifacts';

type ProjectRow = typeof projects.$inferSelect;

type ResolvedMoveTarget = {
  rootPath: string;
  baseRef: string;
};

type MoveTargetPlan =
  | { kind: 'existing'; target: ResolvedMoveTarget }
  | { kind: 'new-local'; sourcePath: string; targetPath: string }
  | {
      kind: 'new-ssh';
      sourcePath: string;
      targetPath: string;
      proxy: SshClientProxy;
    };

export async function moveProjectPath(
  projectId: string,
  params: MoveProjectPathParams
): Promise<Project> {
  const displayName = params.name.trim();
  const requestedPath = params.path.trim();

  if (!displayName) throw new Error('Project name is required');
  if (displayName.length > MAX_PROJECT_ALIAS_LENGTH) {
    throw new Error(`Project name exceeds ${MAX_PROJECT_ALIAS_LENGTH} characters`);
  }
  if (!requestedPath) throw new Error('Project path is required');

  const [row] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!row) throw new Error(`Project ${projectId} not found`);
  if (row.isInternal === 1) throw new Error('Internal projects cannot be moved');

  const plan =
    row.workspaceProvider === 'ssh'
      ? await planSshTarget(row.path, requestedPath, row.sshConnectionId)
      : await planLocalTarget(row.path, requestedPath);
  const plannedPath = plan.kind === 'existing' ? plan.target.rootPath : plan.targetPath;

  const existing = await findProjectAtPath(plannedPath);

  if (existing && existing.id !== projectId) {
    if (params.mergeExistingProjectId !== existing.id) {
      throw new Error(`A project at ${plannedPath} already exists.`);
    }
    return mergeProjectIntoExisting(row, existing);
  }

  const alias = displayName === row.name ? null : displayName;
  const target = plan.kind === 'existing' ? plan.target : null;
  if (
    row.alias === alias &&
    target &&
    row.path === target.rootPath &&
    (row.baseRef ?? 'main') === target.baseRef
  ) {
    return mapProjectRow(row);
  }

  const pathIsChanging =
    plan.kind !== 'existing' ||
    row.path !== plan.target.rootPath ||
    (row.baseRef ?? 'main') !== plan.target.baseRef;
  let projectClosed = false;
  let movedDirectory: MovedProjectDirectory | null = null;

  try {
    if (pathIsChanging) {
      await stopProjectAgentsBeforePathChange(projectId, 'move');
      projectClosed = true;
    }

    if (plan.kind === 'new-local') {
      movedDirectory = await moveLocalProjectDirectory(plan.sourcePath, plan.targetPath);
      await repairLocalGitWorktrees(movedDirectory.targetPath);
    } else if (plan.kind === 'new-ssh') {
      movedDirectory = await moveSshProjectDirectory(plan);
      await repairSshGitWorktrees(plan.proxy, movedDirectory.targetPath);
    }

    const resolvedTarget =
      plan.kind === 'existing'
        ? plan.target
        : row.workspaceProvider === 'ssh'
          ? await resolveSshTarget(movedDirectory!.targetPath, row.sshConnectionId)
          : await resolveLocalTarget(movedDirectory!.targetPath);
    const finalExisting =
      resolvedTarget.rootPath === plannedPath
        ? existing
        : await findProjectAtPath(resolvedTarget.rootPath);
    if (finalExisting && finalExisting.id !== projectId) {
      throw new Error(`A project at ${resolvedTarget.rootPath} already exists.`);
    }

    const [updated] = await db
      .update(projects)
      .set({
        alias,
        path: resolvedTarget.rootPath,
        baseRef: resolvedTarget.baseRef,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(projects.id, projectId))
      .returning();
    if (!updated) throw new Error(`Project ${projectId} not found`);

    if (row.path !== resolvedTarget.rootPath) {
      await syncAgentProjectPathArtifacts(row.path, resolvedTarget.rootPath);
    }
    await movedDirectory?.finalize();
    return mapProjectRow(updated);
  } catch (error) {
    if (movedDirectory) {
      try {
        await movedDirectory.rollback();
        if (row.workspaceProvider === 'ssh') {
          if (plan.kind === 'new-ssh') await repairSshGitWorktrees(plan.proxy, row.path);
        } else {
          await repairLocalGitWorktrees(row.path);
        }
      } catch (rollbackError) {
        log.error('moveProjectPath: failed to roll back project directory move', {
          projectId,
          oldPath: row.path,
          newPath: movedDirectory.targetPath,
          error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        });
      }
    }
    if (projectClosed) {
      await reopenProjectAfterMoveFailure(row);
    }
    throw error;
  }
}

async function findProjectAtPath(projectPath: string): Promise<ProjectRow | undefined> {
  const [existing] = await db
    .select()
    .from(projects)
    .where(eq(projects.path, projectPath))
    .limit(1);
  return existing;
}

async function planLocalTarget(sourcePath: string, requestedPath: string): Promise<MoveTargetPlan> {
  const targetPath = normalizeLocalProjectPath(requestedPath);
  if (await localPathExists(targetPath)) {
    if (!(await nodeFs.stat(targetPath)).isDirectory()) {
      throw new Error('The target project path is not a directory');
    }
    return { kind: 'existing', target: await resolveLocalTarget(targetPath) };
  }

  const source = await resolveLocalTarget(sourcePath);
  assertProjectMoveTarget(source.rootPath, targetPath);
  return { kind: 'new-local', sourcePath: source.rootPath, targetPath };
}

async function planSshTarget(
  sourcePath: string,
  requestedPath: string,
  connectionId: string | null
): Promise<MoveTargetPlan> {
  if (!connectionId) throw new Error('SSH connection is required');
  const targetPath = path.posix.normalize(requestedPath);
  if (!path.posix.isAbsolute(targetPath)) {
    throw new Error('The SSH project path must be absolute');
  }

  const proxy = await sshConnectionManager.connect(connectionId);
  const targetFs = new SshFileSystem(proxy, targetPath);
  const targetEntry = await targetFs.stat('');
  if (targetEntry) {
    if (targetEntry.type !== 'dir') {
      throw new Error('The target project path is not a directory');
    }
    return { kind: 'existing', target: await resolveSshTarget(targetPath, connectionId) };
  }

  const source = await resolveSshTarget(sourcePath, connectionId);
  assertProjectMoveTarget(source.rootPath, targetPath, path.posix);
  return {
    kind: 'new-ssh',
    sourcePath: source.rootPath,
    targetPath,
    proxy,
  };
}

async function moveSshProjectDirectory(
  plan: Extract<MoveTargetPlan, { kind: 'new-ssh' }>
): Promise<MovedProjectDirectory> {
  const rootFs = new SshFileSystem(plan.proxy, '/');
  await rootFs.mkdir(path.posix.dirname(plan.targetPath), { recursive: true });
  const ctx = new SshExecutionContext(plan.proxy);
  try {
    await ctx.exec('mv', [plan.sourcePath, plan.targetPath]);
  } catch (error) {
    ctx.dispose();
    throw error;
  }
  return {
    targetPath: plan.targetPath,
    rollback: async () => {
      try {
        await ctx.exec('mv', [plan.targetPath, plan.sourcePath]);
      } finally {
        ctx.dispose();
      }
    },
    finalize: async () => {
      ctx.dispose();
    },
  };
}

async function repairLocalGitWorktrees(projectPath: string): Promise<void> {
  const ctx = new LocalExecutionContext({ root: projectPath });
  try {
    await ctx.exec('git', ['worktree', 'repair']);
  } catch (error) {
    log.warn('moveProjectPath: failed to repair local git worktrees', {
      projectPath,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    ctx.dispose();
  }
}

async function repairSshGitWorktrees(proxy: SshClientProxy, projectPath: string): Promise<void> {
  const ctx = new SshExecutionContext(proxy, { root: projectPath });
  try {
    await ctx.exec('git', ['worktree', 'repair']);
  } catch (error) {
    log.warn('moveProjectPath: failed to repair SSH git worktrees', {
      projectPath,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    ctx.dispose();
  }
}

async function reopenProjectAfterMoveFailure(row: ProjectRow): Promise<void> {
  try {
    await projectManager.openProject(mapProjectRow(row));
  } catch (error) {
    log.warn('moveProjectPath: failed to reopen project after move rollback', {
      projectId: row.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
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
