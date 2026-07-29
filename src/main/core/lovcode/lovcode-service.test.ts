import { describe, expect, it, vi } from 'vitest';
import {
  LovcodeService,
  mapLovcodeResults,
  parseSearchHits,
  type LovcodeConversationRow,
} from './lovcode-service';

vi.mock('@main/db/client', () => ({
  sqlite: { prepare: vi.fn() },
}));

describe('LovcodeService', () => {
  it('searches globally and returns directly openable Yoda conversations', async () => {
    const runCommand = vi
      .fn<
        (
          args: string[],
          options: { timeout: number; maxBuffer?: number }
        ) => Promise<{ stdout: string }>
      >()
      .mockResolvedValueOnce({ stdout: 'lovcode 0.40.0\n' })
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          { session_id: 'agent-session-2', content: 'second match' },
          { session_id: 'agent-session-1', content: 'first match' },
        ]),
      });
    const loadConversations = vi.fn((): LovcodeConversationRow[] => [
      conversationRow({ id: 'conversation-1', agent_session_id: 'agent-session-1' }),
      conversationRow({
        id: 'conversation-2',
        project_id: 'project-2',
        project_name: 'Project Two',
        task_id: 'task-2',
        task_name: 'Task Two',
        title: 'Second conversation',
        agent_session_id: 'agent-session-2',
      }),
    ]);
    const service = new LovcodeService(runCommand, loadConversations);

    await expect(service.search('  needle  ')).resolves.toEqual({
      status: 'ok',
      items: [
        expect.objectContaining({
          kind: 'conversation',
          id: 'conversation-2',
          projectId: 'project-2',
          taskId: 'task-2',
          title: 'Second conversation',
          subtitle: 'Project Two · Task Two · second match',
        }),
        expect.objectContaining({
          kind: 'conversation',
          id: 'conversation-1',
          projectId: 'project-1',
          taskId: 'task-1',
        }),
      ],
    });
    expect(runCommand).toHaveBeenNthCalledWith(1, ['--version'], { timeout: 3_000 });
    expect(runCommand).toHaveBeenNthCalledWith(2, ['search', 'needle', '--json'], {
      timeout: 10_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    expect(loadConversations).toHaveBeenCalledWith(['agent-session-2', 'agent-session-1']);
  });

  it('reports unavailable and failed searches distinctly', async () => {
    const missingRunner = vi.fn(async () => {
      throw new Error('missing');
    });
    const missing = new LovcodeService(
      missingRunner,
      vi.fn(() => [])
    );
    await expect(missing.search('needle')).resolves.toEqual({ status: 'not-installed' });

    const failingRunner = vi
      .fn<
        (
          args: string[],
          options: { timeout: number; maxBuffer?: number }
        ) => Promise<{ stdout: string }>
      >()
      .mockResolvedValueOnce({ stdout: 'lovcode 0.40.0' })
      .mockRejectedValueOnce(new Error('index unavailable'));
    const failing = new LovcodeService(
      failingRunner,
      vi.fn(() => [])
    );
    await expect(failing.search('needle')).resolves.toEqual({ status: 'error' });
  });
});

describe('Lovcode search result mapping', () => {
  it('parses arrays, result envelopes, and JSONL while deduplicating sessions', () => {
    expect(
      parseSearchHits(
        [
          '{"session_id":"one","content":"first"}',
          'diagnostic output',
          '{"sessionId":"two","summary":"second"}',
          '{"session_id":"one","content":"duplicate"}',
        ].join('\n')
      )
    ).toEqual([
      { sessionId: 'one', excerpt: 'first' },
      { sessionId: 'two', excerpt: 'second' },
    ]);
    expect(
      parseSearchHits(
        JSON.stringify({
          results: [{ session_id: 'three', title: 'third' }],
        })
      )
    ).toEqual([{ sessionId: 'three', excerpt: 'third' }]);
  });

  it('preserves archive metadata and normalizes transcript excerpts', () => {
    const items = mapLovcodeResults(
      [
        conversationRow({
          conversation_archived_at: '2026-07-01T00:00:00.000Z',
          task_archived_at: '2026-07-02T00:00:00.000Z',
        }),
      ],
      [{ sessionId: 'agent-session-1', excerpt: 'multi\nline\tmatch' }]
    );

    expect(items).toEqual([
      expect.objectContaining({
        id: 'conversation-1',
        archived: true,
        taskArchived: true,
        conversationArchived: true,
        subtitle: 'Project One · Task One · multi line match',
      }),
    ]);
  });
});

function conversationRow(overrides: Partial<LovcodeConversationRow> = {}): LovcodeConversationRow {
  return {
    id: 'conversation-1',
    project_id: 'project-1',
    project_name: 'Project One',
    task_id: 'task-1',
    task_name: 'Task One',
    title: 'First conversation',
    last_interacted_at: '2026-07-29T00:00:00.000Z',
    conversation_archived_at: null,
    task_archived_at: null,
    agent_session_id: 'agent-session-1',
    ...overrides,
  };
}
