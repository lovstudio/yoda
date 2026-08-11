import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import type { ProvisionedTask } from '@renderer/features/tasks/stores/task';
import { openProvisionedTaskTab, prepareTaskTarget } from './open-task-target';

const mocks = vi.hoisted(() => ({
  ensureProjectLoaded: vi.fn(),
  ensureTaskLoaded: vi.fn(),
  getArchivedConversationsForTask: vi.fn(),
  getTaskManagerStore: vi.fn(),
  mountProject: vi.fn(),
  provisionTask: vi.fn(),
  showModal: vi.fn(),
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  getProjectManagerStore: () => ({
    ensureProjectLoaded: mocks.ensureProjectLoaded,
    mountProject: mocks.mountProject,
  }),
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  asProvisioned: vi.fn(),
  getTaskManagerStore: mocks.getTaskManagerStore,
  getTaskStore: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    conversations: {
      getArchivedConversationsForTask: mocks.getArchivedConversationsForTask,
    },
  },
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  showModal: mocks.showModal,
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    appTabs: {
      closeTab: vi.fn(),
      openTab: vi.fn(),
      stickTab: vi.fn(),
    },
    navigation: {
      currentViewId: 'home',
      viewParamsStore: {},
    },
    sidePane: {
      unpin: vi.fn(),
    },
  },
}));

vi.mock('@renderer/utils/logger', () => ({
  log: {
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

const archivedConversation: Conversation = {
  id: 'conversation-1',
  projectId: 'project-1',
  taskId: 'task-1',
  runtimeId: 'codex',
  title: 'Archived session',
  archivedAt: '2026-06-27T10:04:17.633Z',
  lastInteractedAt: '2026-06-27T09:38:58.604Z',
  isInitialConversation: true,
};

function createProvisionedTask(ensureConversationResult: boolean): ProvisionedTask {
  return {
    projectId: 'project-1',
    taskId: 'task-1',
    conversations: {
      ensureConversation: vi.fn().mockResolvedValue(ensureConversationResult),
    },
    taskView: {
      setFocusedRegion: vi.fn(),
      setSidebarCollapsed: vi.fn(),
      setSidebarTab: vi.fn(),
      tabManager: {
        closeConversation: vi.fn(),
        hasConversationTab: vi.fn().mockReturnValue(false),
        openConversation: vi.fn(),
        openDiff: vi.fn(),
        openFile: vi.fn(),
        openRoomMember: vi.fn(),
        setActiveTab: vi.fn(),
      },
    },
  } as unknown as ProvisionedTask;
}

describe('openProvisionedTaskTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getArchivedConversationsForTask.mockResolvedValue([]);
    mocks.ensureProjectLoaded.mockResolvedValue(true);
    mocks.mountProject.mockResolvedValue(undefined);
    mocks.ensureTaskLoaded.mockResolvedValue(true);
    mocks.provisionTask.mockResolvedValue(undefined);
    mocks.getTaskManagerStore.mockReturnValue({
      ensureTaskLoaded: mocks.ensureTaskLoaded,
      provisionTask: mocks.provisionTask,
    });
  });

  it('opens an active conversation normally', async () => {
    const provisioned = createProvisionedTask(true);

    const opened = await openProvisionedTaskTab(provisioned, {
      kind: 'conversation',
      conversationId: 'conversation-1',
    });

    expect(opened).toBe(true);
    expect(provisioned.conversations.ensureConversation).toHaveBeenCalledWith('conversation-1');
    expect(provisioned.taskView.tabManager.openConversation).toHaveBeenCalledWith('conversation-1');
    expect(mocks.getArchivedConversationsForTask).not.toHaveBeenCalled();
    expect(mocks.showModal).not.toHaveBeenCalled();
  });

  it('activates the conversation shell before an async replay completes', async () => {
    let finishEnsure!: (found: boolean) => void;
    const provisioned = createProvisionedTask(true);
    vi.mocked(provisioned.conversations.ensureConversation).mockReturnValue(
      new Promise((resolve) => {
        finishEnsure = resolve;
      })
    );
    let current = true;

    const opened = openProvisionedTaskTab(
      provisioned,
      { kind: 'conversation', conversationId: 'conversation-1' },
      { shouldApply: () => current }
    );
    expect(provisioned.taskView.tabManager.openConversation).toHaveBeenCalledWith('conversation-1');
    current = false;
    finishEnsure(true);

    await expect(opened).resolves.toBe(true);
    expect(provisioned.taskView.tabManager.closeConversation).toHaveBeenCalledWith(
      'conversation-1'
    );
    expect(provisioned.taskView.setFocusedRegion).not.toHaveBeenCalled();
  });

  it('opens the archived transcript modal when a deep-linked conversation is archived', async () => {
    const provisioned = createProvisionedTask(false);
    mocks.getArchivedConversationsForTask.mockResolvedValue([archivedConversation]);

    const opened = await openProvisionedTaskTab(provisioned, {
      kind: 'conversation',
      conversationId: 'conversation-1',
    });

    expect(opened).toBe(true);
    expect(mocks.getArchivedConversationsForTask).toHaveBeenCalledWith('project-1', 'task-1');
    expect(provisioned.taskView.tabManager.openConversation).toHaveBeenCalledWith('conversation-1');
    expect(provisioned.taskView.tabManager.closeConversation).toHaveBeenCalledWith(
      'conversation-1'
    );
    expect(provisioned.taskView.setSidebarCollapsed).toHaveBeenCalledWith(false);
    expect(provisioned.taskView.setSidebarTab).toHaveBeenCalledWith('conversations');
    expect(provisioned.taskView.setFocusedRegion).toHaveBeenCalledWith('main');
    expect(mocks.showModal).toHaveBeenCalledWith('archivedSessionTranscriptModal', {
      conversation: archivedConversation,
    });
  });

  it('does not open an archived transcript after its replay is superseded', async () => {
    let finishArchiveLookup!: (conversations: Conversation[]) => void;
    const provisioned = createProvisionedTask(false);
    mocks.getArchivedConversationsForTask.mockReturnValue(
      new Promise((resolve) => {
        finishArchiveLookup = resolve;
      })
    );
    let current = true;

    const opened = openProvisionedTaskTab(
      provisioned,
      { kind: 'conversation', conversationId: 'conversation-1' },
      { shouldApply: () => current }
    );
    await vi.waitFor(() => expect(mocks.getArchivedConversationsForTask).toHaveBeenCalledOnce());
    current = false;
    finishArchiveLookup([archivedConversation]);

    await expect(opened).resolves.toBe(true);
    expect(provisioned.taskView.setSidebarCollapsed).not.toHaveBeenCalled();
    expect(provisioned.taskView.setSidebarTab).not.toHaveBeenCalled();
    expect(mocks.showModal).not.toHaveBeenCalled();
  });

  describe('prepareTaskTarget', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mocks.ensureProjectLoaded.mockResolvedValue(true);
      mocks.mountProject.mockResolvedValue(undefined);
      mocks.ensureTaskLoaded.mockResolvedValue(true);
      mocks.provisionTask.mockResolvedValue(undefined);
      mocks.getTaskManagerStore.mockReturnValue({
        ensureTaskLoaded: mocks.ensureTaskLoaded,
        provisionTask: mocks.provisionTask,
      });
    });

    it('reconciles an externally added project and task before provisioning', async () => {
      await prepareTaskTarget('project-1', 'task-1');

      expect(mocks.ensureProjectLoaded).toHaveBeenCalledWith('project-1');
      expect(mocks.mountProject).toHaveBeenCalledWith('project-1');
      expect(mocks.getTaskManagerStore).toHaveBeenCalledWith('project-1');
      expect(mocks.ensureTaskLoaded).toHaveBeenCalledWith('task-1');
      expect(mocks.provisionTask).toHaveBeenCalledWith('task-1');
    });

    it('stops when the project no longer exists', async () => {
      mocks.ensureProjectLoaded.mockResolvedValue(false);

      await prepareTaskTarget('missing-project', 'task-1');

      expect(mocks.mountProject).not.toHaveBeenCalled();
      expect(mocks.ensureTaskLoaded).not.toHaveBeenCalled();
      expect(mocks.provisionTask).not.toHaveBeenCalled();
    });
  });

  it('returns false when the targeted conversation is neither active nor archived', async () => {
    const provisioned = createProvisionedTask(false);
    mocks.getArchivedConversationsForTask.mockResolvedValue([
      { ...archivedConversation, id: 'other-conversation' },
    ]);

    const opened = await openProvisionedTaskTab(provisioned, {
      kind: 'conversation',
      conversationId: 'conversation-1',
    });

    expect(opened).toBe(false);
    expect(mocks.showModal).not.toHaveBeenCalled();
  });
});
