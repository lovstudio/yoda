import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAllSessionUsageSnapshots, resolveConversationUsage } from './session-usage-snapshot';
import type { SessionTokenUsage } from './transcript-readers/types';

const mocks = vi.hoisted(() => ({
  getResolvedUsage: vi.fn(),
  values: new Map<string, unknown>(),
}));

vi.mock('@main/db/kv', () => ({
  KV: class {
    async get(key: string) {
      return mocks.values.get(key) ?? null;
    }

    async set(key: string, value: unknown) {
      mocks.values.set(key, value);
    }

    async getAll() {
      return Object.fromEntries(mocks.values);
    }
  },
}));

vi.mock('./usage-cache', () => ({
  sessionUsageCache: { getResolvedUsage: mocks.getResolvedUsage },
}));

const usage: SessionTokenUsage = {
  total: {
    input: 10,
    output: 5,
    cacheRead: 30,
    cacheCreation: 2,
    reasoning: 1,
    total: 47,
  },
  context: null,
  daily: [],
  byModel: [],
};

describe('session usage snapshots', () => {
  beforeEach(() => {
    mocks.getResolvedUsage.mockReset();
    mocks.values.clear();
  });

  it('persists live transcript usage and identifies it as current', async () => {
    mocks.getResolvedUsage.mockResolvedValue({ transcriptKey: '/transcript/a', usage });

    await expect(
      resolveConversationUsage('claude', {
        cwd: '/repo',
        conversationId: 'conversation-a',
      })
    ).resolves.toMatchObject({
      transcriptKey: '/transcript/a',
      usage,
      source: 'transcript',
    });

    expect(mocks.values.get('conversation-a')).toMatchObject({
      version: 1,
      runtimeId: 'claude',
      transcriptKey: '/transcript/a',
      usage,
    });
  });

  it('uses the durable snapshot after the provider transcript is cleaned up', async () => {
    mocks.getResolvedUsage.mockResolvedValue(null);
    mocks.values.set('conversation-a', {
      version: 1,
      runtimeId: 'claude',
      transcriptKey: '/transcript/a',
      usage,
      capturedAt: '2026-08-13T00:00:00.000Z',
    });

    await expect(
      resolveConversationUsage('claude', {
        cwd: '/repo',
        conversationId: 'conversation-a',
      })
    ).resolves.toEqual({
      transcriptKey: '/transcript/a',
      usage,
      source: 'snapshot',
    });
  });

  it('filters malformed snapshot rows when loading the overview cache', async () => {
    mocks.values.set('valid', {
      version: 1,
      runtimeId: 'codex',
      transcriptKey: '/rollout/a',
      usage,
      capturedAt: '2026-08-13T00:00:00.000Z',
    });
    mocks.values.set('invalid', { version: 1, runtimeId: 'claude' });

    await expect(getAllSessionUsageSnapshots()).resolves.toEqual(
      new Map([
        [
          'valid',
          {
            version: 1,
            runtimeId: 'codex',
            transcriptKey: '/rollout/a',
            usage,
            capturedAt: '2026-08-13T00:00:00.000Z',
          },
        ],
      ])
    );
  });
});
