import { describe, expect, it, vi } from 'vitest';
import {
  createLovcodeCommandRunner,
  isVersionAtLeast,
  LovcodeService,
  mapLovcodeResults,
  parseSearchHits,
  type LovcodeConversationRow,
} from './lovcode-service';

vi.mock('@main/db/client', () => ({
  sqlite: { prepare: vi.fn() },
}));

describe('LovcodeService', () => {
  it('detects an older desktop app and offers the required upgrade', async () => {
    const runCommand = vi.fn(async () => {
      throw new Error('CLI missing');
    });
    const detectDesktop = vi.fn(async () => ({
      version: '0.39.9',
      executablePath: '/Applications/Lovcode.app/Contents/MacOS/lovcode',
    }));
    const service = new LovcodeService(
      runCommand,
      vi.fn(() => []),
      detectDesktop
    );

    await expect(service.checkAvailability()).resolves.toEqual({
      status: 'upgrade-required',
      version: '0.39.9',
    });
    await expect(service.search('needle')).resolves.toEqual({
      status: 'upgrade-required',
      version: '0.39.9',
    });
    expect(runCommand).toHaveBeenCalledOnce();
    expect(detectDesktop).toHaveBeenCalledOnce();
  });

  it('acknowledges a desktop app whose search interface is unavailable', async () => {
    const service = new LovcodeService(
      vi.fn(async () => {
        throw new Error('CLI missing');
      }),
      vi.fn(() => []),
      vi.fn(async () => ({
        version: null,
        executablePath: '/Applications/Lovcode.app/Contents/MacOS/lovcode',
      }))
    );

    await expect(service.checkAvailability()).resolves.toEqual({
      status: 'desktop-only',
      version: null,
    });
  });

  it('requires an upgrade when the discovered CLI predates indexed search', async () => {
    const detectDesktop = vi.fn(async () => null);
    const service = new LovcodeService(
      vi.fn(async () => ({ stdout: 'lovcode 0.39.9' })),
      vi.fn(() => []),
      detectDesktop
    );

    await expect(service.checkAvailability()).resolves.toEqual({
      status: 'upgrade-required',
      version: 'lovcode 0.39.9',
    });
    expect(detectDesktop).not.toHaveBeenCalled();
  });

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
      vi.fn(() => []),
      vi.fn(async () => null)
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

describe('Lovcode executable discovery', () => {
  it('falls back to the application bundle and reuses the resolved executable', async () => {
    const bundleCommand = '/Applications/lovcode.app/Contents/MacOS/lovcode';
    const discover = vi.fn(async () => ({ commands: ['lovcode', bundleCommand] }));
    const execute = vi.fn(async (command: string) => {
      if (command === 'lovcode') throw new Error('not in PATH');
      return { stdout: 'lovcode 0.40.0' };
    });
    const runCommand = createLovcodeCommandRunner(discover, execute);

    await expect(runCommand(['--version'], { timeout: 3_000 })).resolves.toEqual({
      stdout: 'lovcode 0.40.0',
    });
    await expect(runCommand(['search', 'needle', '--json'], { timeout: 10_000 })).resolves.toEqual({
      stdout: 'lovcode 0.40.0',
    });

    expect(execute.mock.calls.map(([command]) => command)).toEqual([
      'lovcode',
      bundleCommand,
      bundleCommand,
    ]);
    expect(discover).toHaveBeenCalledOnce();
  });

  it('compares desktop versions against the indexed-search contract', () => {
    expect(isVersionAtLeast('0.39.9', '0.40.0')).toBe(false);
    expect(isVersionAtLeast('0.40.0', '0.40.0')).toBe(true);
    expect(isVersionAtLeast('lovcode 0.41.2', '0.40.0')).toBe(true);
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

  it('orders transcript matches by last activity, archived included', () => {
    const items = mapLovcodeResults(
      [
        conversationRow({
          id: 'stale',
          agent_session_id: 'session-stale',
          last_interacted_at: '2026-07-01T00:00:00.000Z',
        }),
        conversationRow({
          id: 'archived-newest',
          agent_session_id: 'session-archived',
          last_interacted_at: '2026-07-30T00:00:00.000Z',
          conversation_archived_at: '2026-07-30T00:00:00.000Z',
        }),
        conversationRow({
          id: 'fresh',
          agent_session_id: 'session-fresh',
          last_interacted_at: '2026-07-20T00:00:00.000Z',
        }),
      ],
      // CLI hit order deliberately disagrees with recency.
      [
        { sessionId: 'session-stale', excerpt: 'a' },
        { sessionId: 'session-archived', excerpt: 'b' },
        { sessionId: 'session-fresh', excerpt: 'c' },
      ]
    );

    expect(items.map((item) => item.id)).toEqual(['archived-newest', 'fresh', 'stale']);
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
