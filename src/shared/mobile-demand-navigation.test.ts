import { describe, expect, it } from 'vitest';
import { prepareCreatedDemandNavigation } from '../../apps/mobile/src/demand-navigation';
import type { MobileDashboardSnapshot, MobileTaskSummary } from './mobile-api';

function task(id: string, projectId = 'project-1'): MobileTaskSummary {
  return {
    id,
    projectId,
    name: id,
    status: 'todo',
    activityStatus: 'todo',
    bootstrapStatus: { status: 'not-started' },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    needsReview: false,
    isPinned: false,
    isFavorite: false,
    isLongTerm: false,
    conversationCount: 1,
    runtimeCounts: { codex: 1 },
  };
}

describe('mobile demand navigation', () => {
  it('selects the created task session and seeds the task before refresh', () => {
    const existingTask = task('existing-task');
    const staleCreatedTask = task('created-task', 'old-project');
    const createdTask = task('created-task', 'target-project');
    const snapshot: MobileDashboardSnapshot = {
      generatedAt: '2026-08-01T00:00:00.000Z',
      projects: [],
      tasks: [existingTask, staleCreatedTask],
      metrics: {
        projectCount: 1,
        openProjectCount: 1,
        activeTaskCount: 2,
        inProgressTaskCount: 0,
        reviewTaskCount: 0,
      },
    };

    const destination = prepareCreatedDemandNavigation(snapshot, createdTask, 'created-session');

    expect(destination).toMatchObject({
      homeTab: 'tasks',
      taskScope: 'all',
      selectedProjectId: 'target-project',
      selectedTaskId: 'created-task',
      selectedSessionId: 'created-session',
    });
    expect(destination.snapshot.tasks).toEqual([createdTask, existingTask]);
    expect(snapshot.tasks).toEqual([existingTask, staleCreatedTask]);
  });
});
