import type { MobileDashboardSnapshot, MobileTaskSummary } from '../../../src/shared/mobile-api';

export function prepareCreatedDemandNavigation(
  snapshot: MobileDashboardSnapshot,
  task: MobileTaskSummary
) {
  return {
    snapshot: {
      ...snapshot,
      tasks: [task, ...snapshot.tasks.filter((candidate) => candidate.id !== task.id)],
    },
    homeTab: 'tasks' as const,
    taskScope: 'all' as const,
    selectedProjectId: task.projectId,
    selectedTaskId: task.id,
    selectedSessionId: null,
  };
}
