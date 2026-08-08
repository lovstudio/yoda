import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFeishuIssueProvider } from './feishu-issue-provider';
import type { FeishuTaskClient } from './lark-cli-client';

describe('feishuIssueProvider', () => {
  const client: FeishuTaskClient = {
    authStatus: vi.fn(),
    listTasks: vi.fn(),
    searchTasks: vi.fn(),
    getTask: vi.fn(),
  };
  const provider = createFeishuIssueProvider(client);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports the CLI user as connected when task read scope is present', async () => {
    vi.mocked(client.authStatus).mockResolvedValue({
      identity: 'user',
      verified: true,
      identities: {
        user: {
          available: true,
          verified: true,
          userName: 'Mark',
          scope: 'offline_access task:task:read',
        },
      },
    });

    await expect(provider.checkConnection()).resolves.toEqual({
      connected: true,
      displayName: 'Mark',
      capabilities: { requiresProjectPath: false, requiresRepositoryUrl: false },
    });
  });

  it('lists incomplete tasks from the CLI and maps them to issues', async () => {
    vi.mocked(client.listTasks).mockResolvedValue([
      {
        guid: 'task-guid-1',
        summary: 'Ship Feishu integration',
        url: 'https://applink.feishu.cn/client/todo/task?guid=task-guid-1',
        completed: false,
        created_at: '2026-08-08T09:00:00+08:00',
      },
    ]);

    const result = await provider.listIssues({ limit: 10 });

    expect(client.listTasks).toHaveBeenCalledWith(10);
    expect(result).toEqual({
      success: true,
      issues: [
        expect.objectContaining({
          provider: 'feishu',
          identifier: 'task-guid-1',
          title: 'Ship Feishu integration',
          status: 'todo',
        }),
      ],
    });
  });

  it('does not invoke CLI search for an empty term', async () => {
    const result = await provider.searchIssues({ searchTerm: '   ', limit: 20 });

    expect(client.searchTasks).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, issues: [] });
  });

  it('hydrates a selected task with description, members, and status', async () => {
    vi.mocked(client.getTask).mockResolvedValue({
      guid: 'task-guid-1',
      summary: 'Ship Feishu integration',
      url: 'https://applink.feishu.cn/client/todo/task?guid=task-guid-1',
      description: 'Use the official lark-cli task domain.',
      status: 'todo',
      members: [{ id: 'ou_mark', name: 'Mark', role: 'assignee', type: 'user' }],
      tasklists: [{ tasklist_guid: 'tasklist-1' }],
      updated_at: '1786150800000',
    });
    const hydrate = provider.hydrateIssue;
    expect(hydrate).toBeDefined();
    if (!hydrate) throw new Error('Expected Feishu issue hydration.');

    const result = await hydrate({
      provider: 'feishu',
      identifier: 'task-guid-1',
      title: 'Ship Feishu integration',
      url: 'https://applink.feishu.cn/client/todo/task?guid=task-guid-1',
    });

    expect(result).toEqual(
      expect.objectContaining({
        description: 'Use the official lark-cli task domain.',
        assignees: ['Mark'],
        project: 'Feishu Tasks',
        status: 'todo',
      })
    );
  });
});
