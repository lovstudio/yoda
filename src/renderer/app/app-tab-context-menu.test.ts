import { describe, expect, it, vi } from 'vitest';
import { revealTabInSidebar, tabSidebarTarget } from '@renderer/app/app-tab-context-menu';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import type { AppTabEntry } from '@renderer/lib/stores/app-tabs-store';

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {},
  events: { on: vi.fn(() => () => undefined), emit: vi.fn() },
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    appTabs: { visibleTabs: [], activeTabId: null },
    sidePane: {},
  },
  sidebarStore: { requestSelectionReveal: vi.fn() },
}));

vi.mock('@renderer/lib/clipboard', () => ({
  copyYodaLink: vi.fn(),
}));

vi.mock('@renderer/features/tasks/components/task-context-menu', () => ({
  TaskContextMenuItems: () => null,
}));

vi.mock('@renderer/features/tasks/components/use-task-menu-actions', () => ({
  useTaskMenuActions: () => null,
}));

function tab(viewId: AppTabEntry['viewId'], params: AppTabEntry['params']): AppTabEntry {
  return { id: 'tab-1', viewId, params };
}

describe('app tab sidebar target', () => {
  it('locates task tabs at their task row', () => {
    expect(tabSidebarTarget(tab('task', { projectId: 'project-1', taskId: 'task-1' }))).toEqual({
      projectId: 'project-1',
      taskId: 'task-1',
    });
  });

  it('locates project pages and project files at their project row', () => {
    expect(tabSidebarTarget(tab('project', { projectId: 'project-1' }))).toEqual({
      projectId: 'project-1',
    });
    expect(
      tabSidebarTarget(tab('file', { projectId: 'project-1', filePath: 'README.md' }))
    ).toEqual({
      projectId: 'project-1',
    });
  });

  it('omits the locator for global and project-less tabs', () => {
    expect(tabSidebarTarget(tab('home', { projectId: 'project-1' }))).toBeUndefined();
    expect(tabSidebarTarget(tab('file', { filePath: '/tmp/README.md' }))).toBeUndefined();
    expect(tabSidebarTarget(tab('task', { projectId: 'project-1' }))).toBeUndefined();
  });

  it('opens the left sidebar before requesting the target row reveal', () => {
    const revealSidebar = vi.fn();

    revealTabInSidebar(tab('task', { projectId: 'project-1', taskId: 'task-1' }), revealSidebar);

    expect(revealSidebar).toHaveBeenCalledOnce();
    expect(sidebarStore.requestSelectionReveal).toHaveBeenCalledWith('project-1', 'task-1');
  });
});
