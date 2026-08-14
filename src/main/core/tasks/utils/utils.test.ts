import { describe, expect, it } from 'vitest';
import type { TaskRow } from '@main/db/schema';
import { mapTaskRowToTask } from './utils';

function taskRow(setupData: string | null): TaskRow {
  return {
    id: 'task-1',
    projectId: 'project-1',
    name: 'Run release',
    status: 'in_progress',
    sourceBranch: null,
    taskBranch: null,
    linkedIssue: null,
    archivedAt: null,
    archiveNote: null,
    archiveRequestedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    lastInteractedAt: null,
    statusChangedAt: '2026-08-01T00:00:00.000Z',
    diffAdditions: null,
    diffDeletions: null,
    diffCapturedAt: null,
    isPinned: 0,
    isFavorite: 0,
    isLongTerm: 0,
    needsReview: 0,
    isUserNamed: 0,
    setupStatus: 'ready',
    setupError: null,
    setupData,
    workspaceProvider: null,
    workspaceId: null,
    workspaceProviderData: null,
    sidebarWorkspaceId: null,
    parentTaskId: null,
    paradigmId: null,
    paradigmKind: null,
    paradigmParams: null,
  };
}

describe('mapTaskRowToTask', () => {
  it('restores the natural-language quick-action source from setup data', () => {
    const task = mapTaskRowToTask(
      taskRow(
        JSON.stringify({
          params: {
            strategy: { kind: 'no-worktree' },
            quickActionSource: {
              prompt: '  Review the release  ',
              conversationId: 'conversation-1',
              invokedSkill: true,
            },
            quickActionId: 'release',
          },
        })
      )
    );

    expect(task.quickActionSource).toEqual({
      prompt: 'Review the release',
      conversationId: 'conversation-1',
      invokedSkill: true,
    });
    expect(task.quickActionId).toBe('release');
  });

  it('ignores incomplete quick-action metadata', () => {
    const task = mapTaskRowToTask(
      taskRow(
        JSON.stringify({
          params: {
            quickActionSource: {
              prompt: 'Review the release',
              conversationId: 'conversation-1',
            },
          },
        })
      )
    );

    expect(task.quickActionSource).toBeUndefined();
  });
});
