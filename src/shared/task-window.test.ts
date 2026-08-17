import { describe, expect, it } from 'vitest';
import {
  encodeTaskWindowDragPayload,
  encodeTaskWindowTarget,
  parseTaskWindowDragPayload,
  parseTaskWindowTargetParam,
  parseTaskWindowTargetSearch,
  TASK_WINDOW_TARGET_PARAM,
  type TaskWindowDragPayload,
  type TaskWindowTarget,
} from './task-window';

describe('task window targets', () => {
  it('round-trips a file tab target through a search param', () => {
    const target: TaskWindowTarget = {
      projectId: 'project-1',
      taskId: 'task-1',
      tab: { kind: 'file', path: 'src/index.ts' },
      bounds: { width: 900, height: 600 },
    };

    const params = new URLSearchParams();
    params.set(TASK_WINDOW_TARGET_PARAM, encodeTaskWindowTarget(target));

    expect(parseTaskWindowTargetSearch(`?${params.toString()}`)).toEqual(target);
  });

  it('accepts a diff tab target with git refs', () => {
    const target: TaskWindowTarget = {
      projectId: 'project-1',
      taskId: 'task-1',
      tab: {
        kind: 'diff',
        path: 'src/index.ts',
        diffGroup: 'pr',
        originalRef: {
          kind: 'branch',
          branch: {
            type: 'remote',
            branch: 'main',
            remote: { name: 'origin', url: 'git@example.com:owner/repo.git' },
          },
        },
        modifiedRef: { kind: 'commit', sha: 'abc123' },
        prNumber: 42,
        status: 'modified',
      },
    };

    expect(parseTaskWindowTargetParam(encodeTaskWindowTarget(target))).toEqual(target);
  });

  it('round-trips a drag payload', () => {
    const payload: TaskWindowDragPayload = {
      sourceWindowId: 12,
      target: {
        projectId: 'project-1',
        taskId: 'task-1',
        tab: { kind: 'conversation', conversationId: 'conversation-1' },
      },
    };

    expect(parseTaskWindowDragPayload(encodeTaskWindowDragPayload(payload))).toEqual(payload);
  });

  it('rejects invalid targets', () => {
    expect(parseTaskWindowTargetParam(null)).toBeNull();
    expect(parseTaskWindowTargetParam('{')).toBeNull();
    expect(
      parseTaskWindowTargetParam(
        JSON.stringify({ projectId: 'project-1', taskId: 'task-1', tab: { kind: 'file' } })
      )
    ).toBeNull();
    expect(
      parseTaskWindowTargetParam(
        JSON.stringify({
          projectId: 'project-1',
          taskId: 'task-1',
          tab: { kind: 'file', path: 'src/index.ts' },
          bounds: { width: -1, height: 600 },
        })
      )
    ).toBeNull();
    // Valid target, invalid window id — isolates the sourceWindowId > 0 check.
    expect(
      parseTaskWindowDragPayload(
        JSON.stringify({
          sourceWindowId: 0,
          target: {
            projectId: 'project-1',
            taskId: 'task-1',
            tab: { kind: 'conversation', conversationId: 'conversation-1' },
          },
        })
      )
    ).toBeNull();
    // A retired task-overview target is no longer a tab entity at all.
    expect(
      parseTaskWindowDragPayload(
        JSON.stringify({
          sourceWindowId: 12,
          target: { projectId: 'project-1', taskId: 'task-1', tab: { kind: 'overview' } },
        })
      )
    ).toBeNull();
  });
});
