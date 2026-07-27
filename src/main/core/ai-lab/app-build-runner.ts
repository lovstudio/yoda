import {
  aiLabAppCreatedChannel,
  aiLabAppUpdatedChannel,
  aiLabBuildFailedChannel,
} from '@shared/events/aiLabEvents';
import { agentSessionRuntimeStore } from '@main/core/conversations/agent-session-runtime';
import { projectManager } from '@main/core/projects/project-manager';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { readAiLabAppProjectBuild } from './app-project-files';
import type { AiLabAppStore } from './app-store';
import type { AiLabBuildJob, AiLabBuildJobStore } from './build-job-store';

export class AiLabAppBuildRunner {
  private initialized = false;
  private subscriptions = new Map<string, () => void>();
  private processing = new Set<string>();

  constructor(
    private readonly jobs: AiLabBuildJobStore,
    private readonly apps: AiLabAppStore
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const pending = await this.jobs.list();
    this.initialized = true;
    for (const job of pending) this.track(job);
  }

  async prepare(job: AiLabBuildJob): Promise<void> {
    await this.initialize();
    await this.jobs.put(job);
    this.track(job);
  }

  async cancel(taskId: string): Promise<void> {
    this.untrack(taskId);
    await this.jobs.delete(taskId);
  }

  private track(job: AiLabBuildJob): void {
    this.untrack(job.taskId);
    const session = {
      projectId: job.projectId,
      taskId: job.taskId,
      conversationId: job.conversationId,
    };
    this.subscriptions.set(
      job.taskId,
      agentSessionRuntimeStore.subscribe(session, (state) => {
        if (state.status === 'completed') void this.finish(job);
        if (state.status === 'error') {
          events.emit(aiLabBuildFailedChannel, {
            ...session,
            message: 'The Yoda Build agent reported an error. Continue in the task to retry.',
          });
        }
      })
    );
    if (agentSessionRuntimeStore.getStatus(session) === 'completed') void this.finish(job);
  }

  private untrack(taskId: string): void {
    this.subscriptions.get(taskId)?.();
    this.subscriptions.delete(taskId);
  }

  private async finish(job: AiLabBuildJob): Promise<void> {
    if (this.processing.has(job.taskId)) return;
    this.processing.add(job.taskId);
    try {
      const generated = await this.readProjectBuild(job.projectId, job.createdAt);
      const target = await this.resolveTargetApp(job);
      if (target) {
        const result = await this.apps.replaceProjectBuild(target.id, {
          ...generated,
          taskId: job.taskId,
          conversationId: job.conversationId,
          runtimeId: job.runtimeId,
          model: job.model,
        });
        events.emit(aiLabAppUpdatedChannel, {
          appId: result.app.id,
          appName: result.app.name,
          projectId: result.app.projectId,
          appProject: result.app.projectKind === 'app',
        });
      } else {
        const app = await this.apps.create({
          ...generated,
          prompt: job.prompt,
          html: '',
          projectKind: job.projectKind,
          projectId: job.projectId,
          taskId: job.taskId,
          conversationId: job.conversationId,
          runtimeId: job.runtimeId,
          model: job.model,
        });
        await this.jobs.put({ ...job, appId: app.id });
        events.emit(aiLabAppCreatedChannel, {
          projectId: job.projectId,
          taskId: job.taskId,
          conversationId: job.conversationId,
          appId: app.id,
          appName: app.name,
          appProject: app.projectKind === 'app',
        });
      }
      this.untrack(job.taskId);
      await this.jobs.delete(job.taskId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn('[ai-lab] failed to validate Yoda Build project output', {
        projectId: job.projectId,
        taskId: job.taskId,
        conversationId: job.conversationId,
        error: message,
      });
      events.emit(aiLabBuildFailedChannel, {
        projectId: job.projectId,
        taskId: job.taskId,
        conversationId: job.conversationId,
        message,
      });
    } finally {
      this.processing.delete(job.taskId);
    }
  }

  private async resolveTargetApp(job: AiLabBuildJob) {
    const apps = await this.apps.list();
    if (job.appId) return apps.find((app) => app.id === job.appId) ?? null;
    return (
      apps.find((app) => app.taskId === job.taskId && app.conversationId === job.conversationId) ??
      null
    );
  }

  private async readProjectBuild(projectId: string, builtAfter: string) {
    const project = projectManager.getProject(projectId);
    if (!project) throw new Error('The App project is not available.');
    return readAiLabAppProjectBuild(project.repoPath, builtAfter);
  }
}
