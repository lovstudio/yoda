import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  shouldResolveTaskScopeEntry,
  stableTaskOpeningMessageKey,
  TASK_OPENING_MESSAGE_KEY,
  TASK_SESSION_OPENING_MESSAGE_KEY,
} from './task-view-opening';

describe('stableTaskOpeningMessageKey', () => {
  it('does not let scope restoration supersede a staged task-open target', () => {
    expect(shouldResolveTaskScopeEntry(null, true)).toBe(false);
    expect(shouldResolveTaskScopeEntry(null, false)).toBe(true);
    expect(shouldResolveTaskScopeEntry({ kind: 'overview' }, false)).toBe(false);

    const taskViewSource = readFileSync(new URL('./view.tsx', import.meta.url), 'utf8');
    expect(taskViewSource).toContain(
      'const shouldResolveScopeEntry = shouldResolveTaskScopeEntry(target, isTargetPending)'
    );
  });

  it('keeps every transient task-entry phase on the same presentation', () => {
    for (const kind of [
      'project-mounting',
      'creating',
      'naming',
      'provisioning',
      'teardown',
      'idle',
    ] as const) {
      expect(
        stableTaskOpeningMessageKey(kind, {
          hasProject: true,
          taskLoadState: 'loading',
          isTaskLoadPending: false,
        })
      ).toBe(TASK_OPENING_MESSAGE_KEY);
    }
  });

  it('treats a lazily loaded task as opening until its task lookup settles', () => {
    expect(
      stableTaskOpeningMessageKey('missing', {
        hasProject: true,
        taskLoadState: 'idle',
        isTaskLoadPending: false,
      })
    ).toBe(TASK_OPENING_MESSAGE_KEY);
    expect(
      stableTaskOpeningMessageKey('missing', {
        hasProject: true,
        taskLoadState: 'loading',
        isTaskLoadPending: false,
      })
    ).toBe(TASK_OPENING_MESSAGE_KEY);
    expect(
      stableTaskOpeningMessageKey('missing', {
        hasProject: true,
        taskLoadState: 'loaded',
        isTaskLoadPending: false,
      })
    ).toBeNull();
    expect(
      stableTaskOpeningMessageKey('missing', {
        hasProject: true,
        taskLoadState: 'loaded',
        isTaskLoadPending: true,
      })
    ).toBe(TASK_OPENING_MESSAGE_KEY);
    expect(
      stableTaskOpeningMessageKey('missing', {
        hasProject: true,
        taskLoadState: 'error',
        isTaskLoadPending: false,
      })
    ).toBeNull();
  });

  it('does not mask terminal task failures as opening states', () => {
    for (const kind of [
      'project-error',
      'create-error',
      'naming-error',
      'provision-error',
      'teardown-error',
      'ready',
    ] as const) {
      expect(
        stableTaskOpeningMessageKey(kind, {
          hasProject: true,
          taskLoadState: 'loaded',
          isTaskLoadPending: false,
        })
      ).toBeNull();
    }
    expect(
      stableTaskOpeningMessageKey('missing', {
        hasProject: false,
        taskLoadState: undefined,
        isTaskLoadPending: false,
      })
    ).toBeNull();
  });

  it('holds the opening surface until the provisioned task target is committed', () => {
    expect(
      stableTaskOpeningMessageKey('ready', {
        hasProject: true,
        taskLoadState: 'loaded',
        isTaskLoadPending: false,
        isTargetPending: true,
      })
    ).toBe(TASK_SESSION_OPENING_MESSAGE_KEY);
    expect(
      stableTaskOpeningMessageKey('ready', {
        hasProject: true,
        taskLoadState: 'loaded',
        isTaskLoadPending: false,
        isTargetPending: false,
      })
    ).toBeNull();
  });

  it('keeps historical delivery content out of the opening surface', () => {
    const mainPanelSource = readFileSync(new URL('./main-panel.tsx', import.meta.url), 'utf8');

    expect(mainPanelSource).toContain('stableTaskOpeningMessageKey');
    expect(mainPanelSource).toContain("defaultSize={taskView.isTerminalDrawerOpen ? '25%' : '0%'}");
    expect(mainPanelSource).toContain('taskView.isTerminalDrawerOpen ? (');
    expect(mainPanelSource).not.toContain('taskDeliverySummariesQuery');
    expect(mainPanelSource).not.toContain('provisionProgressMessage');
  });
});
