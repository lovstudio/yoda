import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotionClient } from './notion-client';
import { notionConnectionService } from './notion-connection-service';
import { notionIssueProvider } from './notion-issue-provider';

vi.mock('./notion-client', () => ({
  createNotionClient: vi.fn(),
}));

vi.mock('./notion-connection-service', () => ({
  notionConnectionService: {
    getCredentials: vi.fn(),
    checkConnection: vi.fn(),
    errorMessage: (error: unknown, fallback: string) =>
      error instanceof Error ? error.message : fallback,
  },
}));

const mockCreateClient = vi.mocked(createNotionClient);
const mockGetCredentials = vi.mocked(notionConnectionService.getCredentials);

function notionPage(
  parent: { type: 'database_id'; database_id: string } | { type: 'workspace'; workspace: true }
) {
  return {
    object: 'page' as const,
    id: parent.type === 'database_id' ? 'page-1' : 'page-2',
    created_time: '2026-07-01T00:00:00.000Z',
    last_edited_time: '2026-07-07T12:00:00.000Z',
    created_by: { object: 'user' as const, id: 'user-1' },
    last_edited_by: { object: 'user' as const, id: 'user-1' },
    cover: null,
    icon: null,
    parent,
    archived: false,
    in_trash: false,
    properties: {
      Name: {
        id: 'title',
        type: 'title' as const,
        title: [{ type: 'text' as const, plain_text: 'Ship Notion integration' }],
      },
      Description: {
        id: 'description',
        type: 'rich_text' as const,
        rich_text: [{ type: 'text' as const, plain_text: 'Use shared database pages.' }],
      },
      Status: {
        id: 'status',
        type: 'status' as const,
        status: { id: 'active', name: 'In progress', color: 'blue' as const },
      },
      Owner: {
        id: 'owner',
        type: 'people' as const,
        people: [{ object: 'user' as const, id: 'user-1', name: 'Mark', avatar_url: null }],
      },
    },
    url: 'https://www.notion.so/page-1',
    public_url: null,
  };
}

describe('notionIssueProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCredentials.mockResolvedValue({ apiToken: 'ntn_test' });
  });

  it('lists shared database pages and maps useful task context', async () => {
    const search = vi.fn().mockResolvedValue({
      results: [
        notionPage({ type: 'workspace', workspace: true }),
        notionPage({ type: 'database_id', database_id: 'db-1' }),
      ],
      has_more: false,
      next_cursor: null,
    });
    mockCreateClient.mockReturnValue({ search } as never);

    const result = await notionIssueProvider.listIssues({ limit: 10 });

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: { property: 'object', value: 'page' },
        sort: { timestamp: 'last_edited_time', direction: 'descending' },
      })
    );
    expect(result).toEqual({
      success: true,
      issues: [
        expect.objectContaining({
          provider: 'notion',
          identifier: 'page-1',
          title: 'Ship Notion integration',
          description: 'Use shared database pages.',
          status: 'In progress',
          assignees: ['Mark'],
          project: 'Database',
        }),
      ],
    });
  });

  it('does not call Notion search for an empty term', async () => {
    const search = vi.fn();
    mockCreateClient.mockReturnValue({ search } as never);

    const result = await notionIssueProvider.searchIssues({ searchTerm: '  ', limit: 20 });

    expect(search).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, issues: [] });
  });

  it('hydrates a selected page with its block content', async () => {
    const retrieve = vi
      .fn()
      .mockResolvedValue(notionPage({ type: 'database_id', database_id: 'db-1' }));
    const list = vi.fn().mockResolvedValue({
      results: [
        {
          object: 'block',
          id: 'block-1',
          type: 'heading_2',
          heading_2: {
            rich_text: [{ type: 'text', plain_text: 'Acceptance criteria' }],
          },
        },
        {
          object: 'block',
          id: 'block-2',
          type: 'to_do',
          to_do: {
            checked: false,
            rich_text: [{ type: 'text', plain_text: 'Show shared pages' }],
          },
        },
      ],
      has_more: false,
      next_cursor: null,
    });
    mockCreateClient.mockReturnValue({
      pages: { retrieve },
      blocks: { children: { list } },
    } as never);
    const hydrate = notionIssueProvider.hydrateIssue;
    expect(hydrate).toBeDefined();
    if (!hydrate) throw new Error('Expected Notion issue hydration.');

    const result = await hydrate({
      provider: 'notion',
      identifier: 'page-1',
      title: 'Ship Notion integration',
      url: 'https://www.notion.so/page-1',
    });

    expect(list).toHaveBeenCalledWith({ block_id: 'page-1', page_size: 100 });
    expect(result.description).toContain('Use shared database pages.');
    expect(result.description).toContain('## Acceptance criteria');
    expect(result.description).toContain('[ ] Show shared pages');
  });
});
