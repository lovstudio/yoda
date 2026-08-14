import { act, createElement, type ButtonHTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { modalStore } from '@renderer/lib/modal/modal-store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setTaskGroupVisibleLimit: vi.fn(),
  updateHomeDraft: vi.fn(),
  updateInterface: vi.fn(),
  sidebarStore: {
    projectTypeFilter: 'all',
    taskSortBy: 'updated-at',
    taskGroupBy: 'project',
    taskPriorityMode: false,
    taskPriorityOrder: [
      'awaiting-input',
      'error',
      'completed',
      'working',
      'idle',
      'pending-review',
      'long-term',
      'archived',
    ],
    taskGroupVisibleLimit: 5,
    taskBranchDisplay: 'compact',
    hideProjectsWithoutActiveTasks: false,
    hideTasksWithoutActiveConversations: false,
    sortNeedsReviewLast: false,
    sortArchivingLast: false,
    setTaskGroupVisibleLimit: vi.fn(),
    applyGroupBy: vi.fn(),
    applySort: vi.fn(),
    setTaskPriorityMode: vi.fn(),
    moveTaskPriorityGroup: vi.fn(),
    resetTaskPriorityOrder: vi.fn(),
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
  useAppSettingsKey: (key: string) =>
    key === 'interface'
      ? {
          value: { newTaskOpenMode: 'home' },
          update: mocks.updateInterface,
        }
      : {
          value: { expressMode: false },
          update: mocks.updateHomeDraft,
        },
}));

vi.mock('@renderer/lib/layout/navigation-provider', () => ({
  useNavigate: () => ({ navigate: mocks.navigate }),
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  sidebarStore: mocks.sidebarStore,
  workspaceStore: { enabled: false },
}));

const renderTrigger = (props: ButtonHTMLAttributes<HTMLButtonElement>) =>
  createElement('button', props);

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click());
  await settle();
}

async function clickWithUserEvent(element: Element): Promise<void> {
  await act(async () => userEvent.click(element));
  await settle();
}

async function chooseSelectItem(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  });
  await settle();
  await click(element);
}

describe('ProjectsSettingsMenu', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sidebarStore.taskPriorityMode = false;
    mocks.sidebarStore.setTaskGroupVisibleLimit = mocks.setTaskGroupVisibleLimit;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    modalStore.closeModal();
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
    await act(async () => root.render(createElement(ProjectsSettingsMenu, { renderTrigger })));

    const viewOptions = host.querySelector<HTMLButtonElement>(
      'button[aria-label="workspaces.viewOptions"]'
    );
    if (!viewOptions) throw new Error('View options trigger is missing');
    await click(viewOptions);

    const popover = document.querySelector<HTMLElement>('[data-slot="popover-content"]');
    const thresholdLabel = Array.from(popover?.querySelectorAll('span') ?? []).find(
      (node) => node.textContent === 'sidebar.collapseThreshold'
    );
    const thresholdTrigger = thresholdLabel?.parentElement?.querySelector<HTMLButtonElement>(
      'button[data-slot="select-trigger"]'
    );

    expect(thresholdTrigger?.textContent).toContain('sidebar.collapseThresholdOption:5');

    if (!thresholdTrigger) throw new Error('Collapse threshold trigger is missing');
    await click(thresholdTrigger);

    const tenTaskOption = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="select-item"]')
    ).find((node) => node.textContent?.includes('sidebar.collapseThresholdOption:10'));
    if (!tenTaskOption) throw new Error('Ten-task threshold option is missing');
    await chooseSelectItem(tenTaskOption);

    expect(mocks.setTaskGroupVisibleLimit).toHaveBeenCalledWith(10);
  });

  it('lets the user open new tasks in a floating window', async () => {
    const { ProjectsSettingsMenu } = await import(
      '@renderer/features/sidebar/projects-group-label'
    );
    await act(async () => root.render(createElement(ProjectsSettingsMenu, { renderTrigger })));

    const viewOptions = host.querySelector<HTMLButtonElement>(
      'button[aria-label="workspaces.viewOptions"]'
    );
    if (!viewOptions) throw new Error('View options trigger is missing');
    await click(viewOptions);

    const floatingOption = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button[data-slot="toggle-group-item"]')
    ).find((button) => button.textContent === 'sidebar.newTaskOpenModal');
    if (!floatingOption) throw new Error('Floating-window option is missing');

    await clickWithUserEvent(floatingOption);

    expect(mocks.updateInterface).toHaveBeenCalledWith({ newTaskOpenMode: 'modal' });
  });

  it('opens the priority order in a compact modal entry when priority mode is enabled', async () => {
    mocks.sidebarStore.taskPriorityMode = true;
    const { ProjectsSettingsMenu } = await import(
      '@renderer/features/sidebar/projects-group-label'
    );
    await act(async () => root.render(createElement(ProjectsSettingsMenu, { renderTrigger })));

    const viewOptions = host.querySelector<HTMLButtonElement>(
      'button[aria-label="workspaces.viewOptions"]'
    );
    if (!viewOptions) throw new Error('View options trigger is missing');
    await click(viewOptions);

    const popover = document.querySelector<HTMLElement>('[data-slot="popover-content"]');
    expect(popover?.textContent).toContain('sidebar.priorityOrderSummary:8');
    expect(popover?.textContent).not.toContain('sidebar.priorityGroups.awaiting-input');
    expect(popover?.textContent).not.toContain('sidebar.priorityGroups.archived');
    expect(popover?.textContent).not.toContain('sidebar.groupBy');

    const priorityOrderEntry = popover?.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]'
    );
    if (!priorityOrderEntry) throw new Error('Priority order modal entry is missing');
    await click(priorityOrderEntry);

    expect(modalStore.activeModalId).toBe('priorityOrderModal');
  });

  it('keeps the complete priority order controls inside the modal', async () => {
    const { PriorityOrderModal } = await import('@renderer/features/sidebar/priority-order-modal');
    const { Dialog, DialogContent } = await import('@renderer/lib/ui/dialog');
    const onClose = vi.fn();

    await act(async () =>
      root.render(
        createElement(
          Dialog,
          { open: true },
          createElement(
            DialogContent,
            {},
            createElement(PriorityOrderModal, { onClose, onSuccess: vi.fn() })
          )
        )
      )
    );

    const dialog = document.querySelector<HTMLElement>('[data-slot="dialog-content"]');
    expect(dialog?.textContent).toContain('sidebar.priorityGroups.awaiting-input');
    expect(dialog?.textContent).toContain('sidebar.priorityGroups.archived');

    const resetButton = Array.from(dialog?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('sidebar.priorityReset')
    );
    if (!resetButton) throw new Error('Priority order reset button is missing');
    await click(resetButton);

    expect(mocks.sidebarStore.resetTaskPriorityOrder).toHaveBeenCalledOnce();
  });
});
