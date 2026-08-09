import { describe, expect, it } from 'vitest';
import {
  NavigationHistoryStore,
  type HistoryEntry,
} from '@renderer/lib/stores/navigation-history-store';

type ViewHistoryEntry = Extract<HistoryEntry, { kind: 'view' }>;

const view = (viewId: ViewHistoryEntry['viewId'], params: Record<string, unknown> = {}) =>
  ({ kind: 'view', viewId, params: params as ViewHistoryEntry['params'] }) satisfies HistoryEntry;

const tab = (projectId: string, taskId: string, tabId: string) =>
  ({ kind: 'tab', projectId, taskId, tabId }) satisfies HistoryEntry;

describe('NavigationHistoryStore', () => {
  it('keeps same-view entries distinct when params differ', () => {
    const history = new NavigationHistoryStore();

    history.push(view('project', { projectId: 'project-1' }));
    history.push(view('project', { projectId: 'project-2' }));

    expect(history.entries).toEqual([
      view('project', { projectId: 'project-1' }),
      view('project', { projectId: 'project-2' }),
    ]);
    expect(history.canGoBack).toBe(true);
  });

  it('treats equivalent params as duplicate current entries', () => {
    const history = new NavigationHistoryStore();

    history.push(view('settings', { tab: 'account', ignored: undefined }));
    history.push(view('settings', { ignored: undefined, tab: 'account' }));

    expect(history.entries).toHaveLength(1);
  });

  it('seeds the current page before the first real navigation', () => {
    const history = new NavigationHistoryStore();

    history.pushNavigation(view('home'), view('settings', { tab: 'general' }));

    expect(history.entries).toEqual([view('home'), view('settings', { tab: 'general' })]);
    expect(history.canGoBack).toBe(true);
  });

  it('returns the latest task page from the current history branch', () => {
    const history = new NavigationHistoryStore();
    history.push(tab('project-1', 'task-1', 'session-a'));
    history.push(tab('project-1', 'task-2', 'session-b'));
    history.push(tab('project-1', 'task-1', 'file-a'));
    history.back(() => {});

    expect(history.lastTaskTab('project-1', 'task-1')).toBe('session-a');
    expect(history.lastTaskTab('project-1', 'task-2')).toBe('session-b');
  });

  it('can skip non-session task pages when resolving a task-row target', () => {
    const history = new NavigationHistoryStore();
    history.push(tab('project-1', 'task-1', 'session-a'));
    history.push(tab('project-1', 'task-1', 'overview'));
    history.push(tab('project-1', 'task-1', 'file-a'));

    expect(
      history.lastTaskTab('project-1', 'task-1', (tabId) => tabId.startsWith('session-'))
    ).toBe('session-a');
  });

  it('does not append when the visible current page already matches the target', () => {
    const history = new NavigationHistoryStore();

    history.push(tab('project-1', 'task-1', 'tab-1'));
    history.pushNavigation(
      view('task', { projectId: 'project-1', taskId: 'task-1' }),
      view('task', { projectId: 'project-1', taskId: 'task-1' })
    );

    expect(history.entries).toEqual([tab('project-1', 'task-1', 'tab-1')]);
  });

  it('replaces a task route placeholder with the concrete active tab', () => {
    const history = new NavigationHistoryStore();

    history.pushNavigation(
      view('project', { projectId: 'project-1' }),
      view('task', { projectId: 'project-1', taskId: 'task-1' })
    );
    const replaced = history.replaceCurrent(tab('project-1', 'task-1', 'tab-1'), (entry) => {
      if (entry.kind !== 'view' || entry.viewId !== 'task') return false;
      const params = entry.params as { projectId?: string; taskId?: string };
      return params.projectId === 'project-1' && params.taskId === 'task-1';
    });

    expect(replaced).toBe(true);
    expect(history.entries).toEqual([
      view('project', { projectId: 'project-1' }),
      tab('project-1', 'task-1', 'tab-1'),
    ]);
  });

  it('does not record reactive pushes while applying back or forward', () => {
    const history = new NavigationHistoryStore();

    history.push(view('home'));
    history.push(view('settings', { tab: 'general' }));
    history.back(() => {
      history.push(view('project', { projectId: 'project-1' }));
    });

    expect(history.entries).toEqual([view('home'), view('settings', { tab: 'general' })]);
    expect(history.currentEntry).toEqual(view('home'));
  });
});
