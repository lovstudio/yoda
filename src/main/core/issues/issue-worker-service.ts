import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  agentSessionExitedChannel,
  agentSessionStatusChangedChannel,
} from '@shared/events/agentEvents';
import { taskStatusUpdatedChannel } from '@shared/events/taskEvents';
import type { Branch } from '@shared/git';
import {
  DEFAULT_ISSUE_WORKER_CONCURRENCY,
  DEFAULT_ISSUE_WORKER_POLL_INTERVAL_SECONDS,
  issueWorkerUpdatedChannel,
  MAX_ISSUE_WORKER_CONCURRENCY,
  MAX_ISSUE_WORKER_POLL_INTERVAL_SECONDS,
  MIN_ISSUE_WORKER_POLL_INTERVAL_SECONDS,
  type IssueWorkerConfigPatch,
  type IssueWorkerProjectConfig,
  type IssueWorkerStatus,
} from '@shared/issue-worker';
import type { RuntimeId } from '@shared/runtime-registry';
import { ensureUniqueTaskDisplayName, normalizeTaskDisplayName } from '@shared/task-name';
import { formatIssueFixPrompt, type Issue, type TaskLifecycleStatus } from '@shared/tasks';
import { projectManager } from '@main/core/projects/project-manager';
import type { ProjectProvider } from '@main/core/projects/project-provider';
import { appSettingsService } from '@main/core/settings/settings-service';
import { createTask } from '@main/core/tasks/operations/createTask';
import { updateTaskStatus } from '@main/core/tasks/operations/updateTaskStatus';
import { db } from '@main/db/client';
import { taskIssueLinks, tasks } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { githubIssueProvider } from '../github/github-issue-provider';
import { resolveIssueWorkerSourceBranch, selectIssueWorkerCandidates } from './issue-worker-utils';

const ISSUE_FETCH_LIMIT = 100;
const ACTIVE_TASK_STATUSES: ReadonlySet<TaskLifecycleStatus> = new Set(['todo', 'in_progress']);

type TaskSnapshot = {
  id: string;
  name: string;
  status: TaskLifecycleStatus;
};

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function defaultConfig(runtime: RuntimeId): IssueWorkerProjectConfig {
  return {
    enabled: false,
    runtime,
    concurrency: DEFAULT_ISSUE_WORKER_CONCURRENCY,
    pollIntervalSeconds: DEFAULT_ISSUE_WORKER_POLL_INTERVAL_SECONDS,
    managedTaskIds: [],
  };
}

function issueTaskName(issue: Issue): string {
  return (
    normalizeTaskDisplayName(`Issue ${issue.identifier} - ${issue.title}`) ||
    `Issue ${issue.identifier}`
  );
}

function statusFor(projectId: string, config: IssueWorkerProjectConfig | null): IssueWorkerStatus {
  return {
    projectId,
    state: config?.enabled ? 'idle' : 'disabled',
    config,
    activeCount: 0,
    queuedCount: 0,
    lastSyncAt: null,
    nextSyncAt: null,
    lastError: null,
  };
}

export class IssueWorkerService {
  private initialized = false;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private scans = new Map<string, Promise<IssueWorkerStatus>>();
  private statuses = new Map<string, IssueWorkerStatus>();
  private generations = new Map<string, number>();
  private off: Array<() => void> = [];

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    this.off.push(
      projectManager.on('projectOpened', (projectId) => {
        void this.reconcileProject(projectId, true);
      }),
      projectManager.on('projectClosed', (projectId) => this.clearTimer(projectId)),
      events.on(agentSessionStatusChangedChannel, (event) => {
        if (event.status === 'completed') {
          void this.finishManagedTask(event.projectId, event.taskId, null);
        } else if (event.status === 'error') {
          void this.finishManagedTask(event.projectId, event.taskId, 'Agent reported an error.');
        }
      }),
      events.on(agentSessionExitedChannel, (event) => {
        const error =
          event.exitCode === undefined || event.exitCode === 0
            ? null
            : `Agent exited with code ${event.exitCode}.`;
        void this.finishManagedTask(event.projectId, event.taskId, error);
      })
    );

    for (const project of projectManager.listProjects()) {
      void this.reconcileProject(project.projectId, true);
    }
  }

  dispose(): void {
    for (const off of this.off.splice(0)) off();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.generations.clear();
    this.initialized = false;
  }

  async getStatus(projectId: string): Promise<IssueWorkerStatus> {
    const config = await this.getConfig(projectId);
    const current = this.statuses.get(projectId) ?? statusFor(projectId, config);
    const tasksForProject = await this.loadTaskSnapshots(projectId);
    const activeCount = config
      ? tasksForProject.filter(
          (task) => config.managedTaskIds.includes(task.id) && ACTIVE_TASK_STATUSES.has(task.status)
        ).length
      : 0;
    const next = {
      ...current,
      config,
      activeCount,
      state: !config?.enabled
        ? ('disabled' as const)
        : activeCount >= config.concurrency && current.state !== 'syncing'
          ? ('at-capacity' as const)
          : current.state,
    };
    this.statuses.set(projectId, next);
    return next;
  }

  async configure(projectId: string, patch: IssueWorkerConfigPatch): Promise<IssueWorkerStatus> {
    const defaultRuntime = await appSettingsService.get('defaultRuntime');
    await appSettingsService.updateComputed('issueWorker', (current) => {
      const existing = current.projects[projectId] ?? defaultConfig(defaultRuntime);
      const next: IssueWorkerProjectConfig = {
        ...existing,
        ...patch,
        concurrency:
          patch.concurrency === undefined
            ? existing.concurrency
            : clampInteger(patch.concurrency, 1, MAX_ISSUE_WORKER_CONCURRENCY),
        pollIntervalSeconds:
          patch.pollIntervalSeconds === undefined
            ? existing.pollIntervalSeconds
            : clampInteger(
                patch.pollIntervalSeconds,
                MIN_ISSUE_WORKER_POLL_INTERVAL_SECONDS,
                MAX_ISSUE_WORKER_POLL_INTERVAL_SECONDS
              ),
      };
      return { ...current, projects: { ...current.projects, [projectId]: next } };
    });

    this.generations.set(projectId, (this.generations.get(projectId) ?? 0) + 1);
    this.clearTimer(projectId);
    await this.scans.get(projectId);
    return this.runNow(projectId);
  }

  runNow(projectId: string): Promise<IssueWorkerStatus> {
    const existing = this.scans.get(projectId);
    if (existing) return existing;

    this.clearTimer(projectId);
    const scan = this.scan(projectId).finally(() => this.scans.delete(projectId));
    this.scans.set(projectId, scan);
    return scan;
  }

  private async reconcileProject(projectId: string, runImmediately: boolean): Promise<void> {
    const config = await this.getConfig(projectId);
    if (!config?.enabled) {
      this.publish(statusFor(projectId, config));
      return;
    }
    if (runImmediately) await this.runNow(projectId);
    else this.schedule(projectId, config.pollIntervalSeconds);
  }

  private async scan(projectId: string): Promise<IssueWorkerStatus> {
    const generation = this.generations.get(projectId) ?? 0;
    const config = await this.getConfig(projectId);
    if (!config?.enabled) {
      const disabled = statusFor(projectId, config);
      this.publish(disabled);
      return disabled;
    }

    const project = projectManager.getProject(projectId);
    if (!project) {
      const idle = statusFor(projectId, config);
      this.publish(idle);
      return idle;
    }

    const taskSnapshots = await this.loadTaskSnapshots(projectId);
    const taskById = new Map(taskSnapshots.map((task) => [task.id, task]));
    const managedTaskIds = config.managedTaskIds.filter((id) => {
      const task = taskById.get(id);
      return task && ACTIVE_TASK_STATUSES.has(task.status);
    });
    if (managedTaskIds.length !== config.managedTaskIds.length) {
      await this.replaceManagedTaskIds(projectId, managedTaskIds);
    }
    const activeConfig = { ...config, managedTaskIds };

    const activeCount = managedTaskIds.length;
    const available = Math.max(0, activeConfig.concurrency - activeCount);
    if (available === 0) {
      const full = this.nextStatus(projectId, activeConfig, {
        state: 'at-capacity',
        activeCount,
      });
      this.publishAndSchedule(full);
      return full;
    }

    this.publish(
      this.nextStatus(projectId, activeConfig, {
        state: 'syncing',
        activeCount,
        lastError: null,
      })
    );

    try {
      const remoteUrl = await this.resolveRemoteUrl(project);
      const result = await githubIssueProvider.listIssues({
        projectId,
        projectPath: project.repoPath,
        repositoryUrl: remoteUrl,
        limit: ISSUE_FETCH_LIMIT,
      });
      if (!result.success) throw new Error(result.error);

      const linkedRows = await db
        .select({ issueUrl: taskIssueLinks.issueUrl })
        .from(taskIssueLinks)
        .innerJoin(tasks, eq(taskIssueLinks.taskId, tasks.id))
        .where(eq(tasks.projectId, projectId));
      const linkedIssueUrls = new Set(linkedRows.map((row) => row.issueUrl));
      const allPending = selectIssueWorkerCandidates(
        result.issues,
        linkedIssueUrls,
        Number.POSITIVE_INFINITY
      );
      const candidates = allPending.slice(0, available);
      const sourceBranch = await this.resolveSourceBranch(project);
      if (!sourceBranch && candidates.length > 0) {
        throw new Error('No usable source branch is available for issue tasks.');
      }

      let created = 0;
      let firstError: string | null = null;
      const existingNames = new Set(taskSnapshots.map((task) => task.name));
      for (const issue of candidates) {
        const liveConfig = await this.getConfig(projectId);
        if (generation !== (this.generations.get(projectId) ?? 0) || !liveConfig?.enabled) {
          break;
        }
        try {
          const name = ensureUniqueTaskDisplayName(issueTaskName(issue), existingNames);
          existingNames.add(name);
          await this.createIssueTask(projectId, config.runtime, issue, name, sourceBranch!);
          created += 1;
        } catch (error) {
          firstError ??= error instanceof Error ? error.message : String(error);
          log.warn('Issue worker failed to create a task', {
            projectId,
            issue: issue.identifier,
            error: firstError,
          });
        }
      }

      const latestConfig = (await this.getConfig(projectId)) ?? activeConfig;
      const latestTasks = await this.loadTaskSnapshots(projectId);
      const latestActiveCount = latestTasks.filter(
        (task) =>
          latestConfig.managedTaskIds.includes(task.id) && ACTIVE_TASK_STATUSES.has(task.status)
      ).length;
      const next = this.nextStatus(projectId, latestConfig, {
        state: firstError
          ? 'error'
          : latestActiveCount >= latestConfig.concurrency
            ? 'at-capacity'
            : 'idle',
        activeCount: latestActiveCount,
        queuedCount: Math.max(0, allPending.length - created),
        lastSyncAt: new Date().toISOString(),
        lastError: firstError,
      });
      this.publishAndSchedule(next);
      return next;
    } catch (error) {
      const failed = this.nextStatus(projectId, config, {
        state: 'error',
        activeCount,
        lastSyncAt: new Date().toISOString(),
        lastError: error instanceof Error ? error.message : String(error),
      });
      this.publishAndSchedule(failed);
      return failed;
    }
  }

  private async createIssueTask(
    projectId: string,
    runtime: RuntimeId,
    issue: Issue,
    name: string,
    sourceBranch: Branch
  ): Promise<void> {
    const taskId = randomUUID();
    await this.addManagedTask(projectId, taskId);
    try {
      const prompt = formatIssueFixPrompt(issue);
      const result = await createTask({
        id: taskId,
        projectId,
        name,
        sourceBranch,
        strategy: { kind: 'new-branch', taskBranch: name, pushBranch: false },
        linkedIssue: issue,
        initialConversation: {
          id: randomUUID(),
          projectId,
          taskId,
          runtime,
          title: `${issue.identifier} ${issue.title}`,
          initialPrompt: prompt,
          autoApprove: true,
          executionMode: 'automation',
        },
      });
      if (!result.success) throw new Error(JSON.stringify(result.error));
    } catch (error) {
      const [persisted] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId));
      if (persisted) {
        await updateTaskStatus(taskId, 'review');
        events.emit(taskStatusUpdatedChannel, { taskId, projectId, status: 'review' });
      }
      await this.removeManagedTask(projectId, taskId);
      throw error;
    }
  }

  private async finishManagedTask(
    projectId: string,
    taskId: string,
    error: string | null
  ): Promise<void> {
    const config = await this.getConfig(projectId);
    if (!config?.managedTaskIds.includes(taskId)) return;

    const [task] = await db
      .select({ status: tasks.status })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
      .limit(1);
    if (task && ACTIVE_TASK_STATUSES.has(task.status as TaskLifecycleStatus)) {
      await updateTaskStatus(taskId, 'review');
      events.emit(taskStatusUpdatedChannel, { taskId, projectId, status: 'review' });
    }
    await this.removeManagedTask(projectId, taskId);

    const current = await this.getStatus(projectId);
    const next = {
      ...current,
      state: !current.config?.enabled
        ? ('disabled' as const)
        : error
          ? ('error' as const)
          : ('idle' as const),
      lastError: error,
    };
    if (error) {
      this.publishAndSchedule(next);
    } else {
      this.publish(next);
      void this.runNow(projectId);
    }
  }

  private async loadTaskSnapshots(projectId: string): Promise<TaskSnapshot[]> {
    const rows = await db
      .select({ id: tasks.id, name: tasks.name, status: tasks.status })
      .from(tasks)
      .where(eq(tasks.projectId, projectId));
    return rows.map((row) => ({ ...row, status: row.status as TaskLifecycleStatus }));
  }

  private async resolveRemoteUrl(project: ProjectProvider): Promise<string> {
    const [configuredRemote, remotes] = await Promise.all([
      project.repository.getConfiguredRemote(),
      project.repository.getRemotes(),
    ]);
    const remote = remotes.find((item) => item.name === configuredRemote) ?? remotes[0];
    if (!remote?.url) throw new Error('No GitHub remote is configured for this project.');
    return remote.url;
  }

  private async resolveSourceBranch(project: ProjectProvider): Promise<Branch | null> {
    const [payload, settings] = await Promise.all([
      project.repository.getBranchesPayload(),
      project.settings.get(),
    ]);
    const preferredRef = await project.settings.getDefaultBranch(settings);
    return resolveIssueWorkerSourceBranch(payload, preferredRef);
  }

  private async getConfig(projectId: string): Promise<IssueWorkerProjectConfig | null> {
    const settings = await appSettingsService.get('issueWorker');
    return settings.projects[projectId] ?? null;
  }

  private async addManagedTask(projectId: string, taskId: string): Promise<void> {
    await appSettingsService.updateComputed('issueWorker', (current) => {
      const config = current.projects[projectId];
      if (!config || config.managedTaskIds.includes(taskId)) return current;
      return {
        ...current,
        projects: {
          ...current.projects,
          [projectId]: { ...config, managedTaskIds: [...config.managedTaskIds, taskId] },
        },
      };
    });
  }

  private async removeManagedTask(projectId: string, taskId: string): Promise<void> {
    await appSettingsService.updateComputed('issueWorker', (current) => {
      const config = current.projects[projectId];
      if (!config?.managedTaskIds.includes(taskId)) return current;
      return {
        ...current,
        projects: {
          ...current.projects,
          [projectId]: {
            ...config,
            managedTaskIds: config.managedTaskIds.filter((id) => id !== taskId),
          },
        },
      };
    });
  }

  private async replaceManagedTaskIds(projectId: string, managedTaskIds: string[]): Promise<void> {
    await appSettingsService.updateComputed('issueWorker', (current) => {
      const config = current.projects[projectId];
      if (!config) return current;
      return {
        ...current,
        projects: { ...current.projects, [projectId]: { ...config, managedTaskIds } },
      };
    });
  }

  private nextStatus(
    projectId: string,
    config: IssueWorkerProjectConfig,
    patch: Partial<IssueWorkerStatus>
  ): IssueWorkerStatus {
    return {
      ...(this.statuses.get(projectId) ?? statusFor(projectId, config)),
      ...patch,
      projectId,
      config,
      nextSyncAt: null,
    };
  }

  private publish(status: IssueWorkerStatus): void {
    this.statuses.set(status.projectId, status);
    events.emit(issueWorkerUpdatedChannel, status);
  }

  private publishAndSchedule(status: IssueWorkerStatus): void {
    const interval = status.config?.pollIntervalSeconds;
    if (status.config?.enabled && interval) {
      const nextSyncAt = new Date(Date.now() + interval * 1_000).toISOString();
      status = { ...status, nextSyncAt };
      this.schedule(status.projectId, interval);
    }
    this.publish(status);
  }

  private schedule(projectId: string, seconds: number): void {
    this.clearTimer(projectId);
    const timer = setTimeout(() => void this.runNow(projectId), seconds * 1_000);
    timer.unref?.();
    this.timers.set(projectId, timer);
  }

  private clearTimer(projectId: string): void {
    const timer = this.timers.get(projectId);
    if (timer) clearTimeout(timer);
    this.timers.delete(projectId);
  }
}

export const issueWorkerService = new IssueWorkerService();
