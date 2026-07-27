import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getActiveRuntimeStatuses } from './getActiveRuntimeStatuses';

const mocks = vi.hoisted(() => ({
  activeRows: [] as Array<Record<string, unknown>>,
  decodeTmuxSessionName: vi.fn(),
  deriveStatus: vi.fn(),
  disposeLocalContext: vi.fn(),
  getAllStatuses: vi.fn(),
  getProject: vi.fn(),
  listTmuxSessionMarkers: vi.fn(),
  localProjectRows: [] as Array<{ id: string }>,
  select: vi.fn(),
}));

vi.mock('@main/core/execution-context/local-execution-context', () => ({
  LocalExecutionContext: class {
    readonly supportsLocalSpawn = true;
    readonly root = undefined;
    exec = vi.fn();
    execStreaming = vi.fn();
    dispose = mocks.disposeLocalContext;
  },
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: { getProject: mocks.getProject },
}));

vi.mock('@main/core/pty/tmux-session-name', () => ({
  decodeTmuxSessionName: mocks.decodeTmuxSessionName,
  listTmuxSessionMarkers: mocks.listTmuxSessionMarkers,
}));

vi.mock('@main/db/client', () => ({
  db: { select: mocks.select },
}));

vi.mock('./agent-session-runtime', () => ({
  agentSessionRuntimeStore: { getAllStatuses: mocks.getAllStatuses },
}));

vi.mock('./getConversationRuntimeStatuses', () => ({
  getConversationRunStatus: mocks.deriveStatus,
}));

describe('getActiveRuntimeStatuses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.localProjectRows = [{ id: 'project-1' }];
    mocks.activeRows = [];
    mocks.getAllStatuses.mockReturnValue([]);
    mocks.listTmuxSessionMarkers.mockResolvedValue([]);
    mocks.deriveStatus.mockResolvedValue('idle');
    mocks.select.mockImplementation((selection: Record<string, unknown>) => {
      if (Object.keys(selection).length === 1 && 'id' in selection) {
        return {
          from: () => ({
            where: () => Promise.resolve(mocks.localProjectRows),
          }),
        };
      }
      const chain = {
        innerJoin: () => chain,
        where: () => Promise.resolve(mocks.activeRows),
      };
      return { from: () => chain };
    });
  });

  it('derives only conversations represented by surviving tmux markers', async () => {
    mocks.listTmuxSessionMarkers.mockResolvedValue([
      { sessionName: 'marker-1', cwd: '/repo/worktree' },
      { sessionName: 'terminal-marker', cwd: '/repo/worktree' },
    ]);
    mocks.decodeTmuxSessionName.mockImplementation((name: string) => {
      if (name === 'marker-1') return 'project-1:task-1:conversation-1';
      if (name === 'terminal-marker') return 'project-1:task-1:terminal-1';
      return undefined;
    });
    mocks.activeRows = [
      {
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'conversation-1',
        runtime: 'claude',
        title: 'Agent',
        createdAt: '2026-07-27T00:00:00.000Z',
        config: null,
      },
    ];
    mocks.deriveStatus.mockResolvedValue('awaiting-input');

    await expect(getActiveRuntimeStatuses()).resolves.toEqual({
      coveredProjectIds: ['project-1'],
      entries: [
        {
          projectId: 'project-1',
          taskId: 'task-1',
          conversationId: 'conversation-1',
          status: 'awaiting-input',
        },
      ],
    });
    expect(mocks.deriveStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-1',
        cwd: '/repo/worktree',
      })
    );
    expect(mocks.deriveStatus).toHaveBeenCalledTimes(1);
    expect(mocks.disposeLocalContext).toHaveBeenCalledOnce();
  });

  it('returns the live main-process cache without re-reading transcripts', async () => {
    mocks.getAllStatuses.mockReturnValue([
      {
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'conversation-1',
        status: 'working',
      },
    ]);
    mocks.activeRows = [
      {
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'conversation-1',
        runtime: 'codex',
        title: 'Agent',
        createdAt: '2026-07-27T00:00:00.000Z',
        config: null,
      },
    ];

    const snapshot = await getActiveRuntimeStatuses();

    expect(snapshot.entries).toEqual([
      {
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'conversation-1',
        status: 'working',
      },
    ]);
    expect(mocks.deriveStatus).not.toHaveBeenCalled();
  });
});
