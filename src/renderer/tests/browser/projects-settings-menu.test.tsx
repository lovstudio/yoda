import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setTaskGroupVisibleLimit: vi.fn(),
  updateHomeDraft: vi.fn(),
  sidebarStore: {
    projectTypeFilter: 'all',
    taskSortBy: 'updated-at',
    taskGroupBy: 'project',
    taskGroupVisibleLimit: 5,
    taskBranchDisplay: 'compact',
    hideProjectsWithoutActiveTasks: false,
    hideTasksWithoutActiveConversations: false,
    sortNeedsReviewLast: false,
    sortArchivingLast: false,
    setTaskGroupVisibleLimit: vi.fn(),
    applyGroupBy: vi.fn(),
    applySort: vi.fn(),
    setTaskBranchDisplay: vi.fn(),
    setProjectTypeFilter: vi.fn(),
    setSortNeedsReviewLast: vi.fn(),
    setSortArchivingLast: vi.fn(),
    setHideProjectsWithoutActiveTasks: vi.fn(),
    setHideTasksWithoutActiveConversations: vi.fn(),
    expandAllProjects: vi.fn(),
    collapseAllProjects: vi.fn(),
    clearManualTaskOrder: vi.fn(),
  },
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) =>
      values?.count === undefined ? key : `${key}:${values.count}`,
  }),
}));

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({
    value: { expressMode: false },
    update: mocks.updateHomeDraft,
  }),
}));

vi.mock('@renderer/lib/layout/navigation-provider', () => ({
  useNavigate: () => ({ navigate: mocks.navigate }),
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  sidebarStore: mocks.sidebarStore,
}));

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe('ProjectsSettingsMenu', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sidebarStore.setTaskGroupVisibleLimit = mocks.setTaskGroupVisibleLimit;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document
      .querySelectorAll('[data-slot="popover-content"], [data-slot="select-content"]')
      .forEach((node) => node.remove());
    host.remove();
  });

  it('shows the default collapse threshold and applies another option', async () => {
    const { ProjectsSettingsMenu } = await import(
      '@renderer/features/sidebar/projects-group-label'
    );
    await act(async () => root.render(createElement(ProjectsSettingsMenu)));

    const viewOptions = host.querySelector<HTMLButtonElement>(
      'button[aria-label="workspaces.viewOptions"]'
    );
    if (!viewOptions) throw new Error('View options trigger is missing');
    await userEvent.click(viewOptions);
    await settle();

    const popover = document.querySelector<HTMLElement>('[data-slot="popover-content"]');
    const thresholdLabel = Array.from(popover?.querySelectorAll('span') ?? []).find(
      (node) => node.textContent === 'sidebar.collapseThreshold'
    );
    const thresholdTrigger = thresholdLabel?.parentElement?.querySelector<HTMLButtonElement>(
      'button[data-slot="select-trigger"]'
    );

    expect(thresholdTrigger?.textContent).toContain('sidebar.collapseThresholdOption:5');

    if (!thresholdTrigger) throw new Error('Collapse threshold trigger is missing');
    await userEvent.click(thresholdTrigger);
    await settle();

    const tenTaskOption = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="select-item"]')
    ).find((node) => node.textContent?.includes('sidebar.collapseThresholdOption:10'));
    if (!tenTaskOption) throw new Error('Ten-task threshold option is missing');
    await userEvent.click(tenTaskOption);
    await settle();

    expect(mocks.setTaskGroupVisibleLimit).toHaveBeenCalledWith(10);
  });
});
