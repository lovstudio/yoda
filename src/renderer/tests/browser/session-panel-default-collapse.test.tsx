import { observable, type IObservableValue } from 'mobx';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskSidebarPreferenceStore } from '@renderer/features/tasks/stores/task-sidebar-preferences';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface TestTaskView {
  sidebarPrefs: TaskSidebarPreferenceStore;
  readonly isSidebarCollapsed: boolean;
  readonly sessionPanelOpenSectionIds: string[];
  readonly sidebarTab: TaskSidebarPreferenceStore['sidebarTab'];
  setSessionPanelOpenSectionIds(sectionIds: string[]): void;
}

const mocks = vi.hoisted(() => ({
  taskView: null as TestTaskView | null,
  sidebarCollapsed: null as IObservableValue<boolean> | null,
  setSessionPanelOpenSectionIds: vi.fn<(sectionIds: string[]) => void>(),
  useConversationTranscript: vi.fn((_active: boolean) => ({})),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: { emit: vi.fn(), on: vi.fn(() => () => undefined) },
  rpc: {},
}));

vi.mock('@renderer/features/tasks/task-view-context', () => ({
  useRequireProvisionedTask: () => ({ taskView: mocks.taskView }),
}));

vi.mock('@renderer/features/tasks/context-panel', () => ({
  HarnessSection: () => null,
}));

vi.mock('@renderer/features/tasks/session-info-panel', () => ({
  SessionInfoPanel: () => null,
  SessionOverviewAIButton: () => null,
  SessionOverviewPanel: () => null,
  SessionPromptsContent: () => null,
  SessionPromptsCount: () => null,
  SessionPromptsViewAllButton: () => null,
  useSessionPrompts: () => ({}),
}));

vi.mock('@renderer/features/tasks/task-panel', () => ({
  TaskPanel: () => null,
  TaskTodosCount: () => null,
  useTaskTodos: () => ({}),
}));

vi.mock('@renderer/features/tasks/transcript-panel', () => ({
  TranscriptContent: () => null,
  TranscriptCount: () => null,
  TranscriptFileActions: () => null,
  useConversationTranscript: mocks.useConversationTranscript,
}));

describe('SessionPanel default section', () => {
  let host: HTMLDivElement;
  let root: Root;
  let sidebarPrefs: TaskSidebarPreferenceStore;

  beforeEach(() => {
    sidebarPrefs = new TaskSidebarPreferenceStore();
    sidebarPrefs.setSidebarTab('changes');
    sidebarPrefs.sessionPanelUnitOrder = ['basic'];
    mocks.sidebarCollapsed = observable.box(false);
    mocks.setSessionPanelOpenSectionIds.mockReset();
    mocks.useConversationTranscript.mockClear();
    mocks.setSessionPanelOpenSectionIds.mockImplementation((sectionIds) =>
      sidebarPrefs.setSessionPanelOpenSectionIds(sectionIds)
    );
    mocks.taskView = {
      sidebarPrefs,
      get isSidebarCollapsed() {
        return mocks.sidebarCollapsed?.get() ?? false;
      },
      get sessionPanelOpenSectionIds() {
        return [...sidebarPrefs.sessionPanelOpenSectionIds];
      },
      get sidebarTab() {
        return sidebarPrefs.sidebarTab;
      },
      setSessionPanelOpenSectionIds: mocks.setSessionPanelOpenSectionIds,
    };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('keeps every section collapsed when returning from another sidebar card', async () => {
    const { SessionPanel } = await import('@renderer/features/tasks/view/session-panel');
    await act(async () => root.render(<SessionPanel />));

    await act(async () => sidebarPrefs.setSidebarTab('session'));

    const basicTrigger = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('tasks.sessionPanel.basic')
    );
    expect(basicTrigger?.getAttribute('aria-expanded')).toBe('false');
    expect(mocks.setSessionPanelOpenSectionIds).not.toHaveBeenCalled();
    expect(sidebarPrefs.sessionPanelOpenSectionIds).toEqual([]);
  });

  it('subscribes to the transcript only while its blind is open and visible', async () => {
    sidebarPrefs.setSidebarTab('session');
    sidebarPrefs.sessionPanelUnitOrder = ['transcript'];
    const { SessionPanel } = await import('@renderer/features/tasks/view/session-panel');
    await act(async () => root.render(<SessionPanel />));

    expect(mocks.useConversationTranscript).toHaveBeenLastCalledWith(false);
    const transcriptTrigger = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('tasks.sessionPanel.transcript')
    );
    await act(async () => transcriptTrigger?.click());
    expect(mocks.useConversationTranscript).toHaveBeenLastCalledWith(true);

    await act(async () => sidebarPrefs.setSidebarTab('changes'));
    expect(mocks.useConversationTranscript).toHaveBeenLastCalledWith(false);

    await act(async () => sidebarPrefs.setSidebarTab('session'));
    expect(mocks.useConversationTranscript).toHaveBeenLastCalledWith(true);

    await act(async () => mocks.sidebarCollapsed?.set(true));
    expect(mocks.useConversationTranscript).toHaveBeenLastCalledWith(false);
  });
});
