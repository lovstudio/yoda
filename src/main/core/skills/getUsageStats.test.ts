import { describe, expect, it, vi } from 'vitest';
import type { SkillUsageIndex } from '@shared/skills/types';
import {
  SkillUsageStatsService,
  type SkillUsageSnapshotStore,
} from '@main/core/skills/getUsageStats';

vi.mock('@main/db/kv', () => ({
  KV: class KV {
    async get() {
      return null;
    }

    async set() {}
  },
}));

function snapshot(total: number): SkillUsageIndex {
  return {
    generatedAt: '2026-07-29T00:00:00.000Z',
    bySkill: {
      example: {
        skill: 'example',
        total,
        manual: total,
        auto: 0,
        lastUsedAt: '2026-07-29T00:00:00.000Z',
        daily: { '2026-07-29': total },
      },
    },
  };
}

function createStore(initial: SkillUsageIndex | null = null) {
  let value = initial;
  const store: SkillUsageSnapshotStore = {
    get: vi.fn(async () => value),
    set: vi.fn(async (next) => {
      value = next;
    }),
  };
  return store;
}

function output(total: number): string {
  return `skillusage v0.2.0\n${JSON.stringify({
    generatedAt: '2026-07-29T01:00:00.000Z',
    skills: [
      {
        skill: 'example',
        total,
        manual: total - 1,
        auto: 1,
        lastUsedAt: '2026-07-29T01:00:00.000Z',
        daily: { '2026-07-29': total },
        aliases: ['Example Alias'],
      },
    ],
  })}`;
}

describe('SkillUsageStatsService', () => {
  it('returns the persisted snapshot without starting a history scan', async () => {
    const runSkillusage = vi.fn(async () => output(8));
    const service = new SkillUsageStatsService(runSkillusage, createStore(snapshot(7)));

    await expect(service.get()).resolves.toEqual(snapshot(7));
    expect(runSkillusage).not.toHaveBeenCalled();
  });

  it('peeks at usage data without starting the first history scan', async () => {
    const runSkillusage = vi.fn(async () => output(8));
    const service = new SkillUsageStatsService(runSkillusage, createStore());

    await expect(service.peek()).resolves.toBeNull();
    expect(runSkillusage).not.toHaveBeenCalled();
  });

  it('refreshes the snapshot and indexes aliases', async () => {
    const store = createStore(snapshot(7));
    const service = new SkillUsageStatsService(
      vi.fn(async () => output(8)),
      store
    );

    const result = await service.get(true);

    expect(result.bySkill.example.total).toBe(8);
    expect(result.bySkill['example alias']).toBe(result.bySkill.example);
    expect(store.set).toHaveBeenCalledWith(result);
  });

  it('coalesces concurrent refreshes into one incremental scan', async () => {
    let resolveOutput!: (value: string) => void;
    const pendingOutput = new Promise<string>((resolve) => {
      resolveOutput = resolve;
    });
    const runSkillusage = vi.fn(() => pendingOutput);
    const service = new SkillUsageStatsService(runSkillusage, createStore());

    const first = service.get(true);
    const second = service.get(true);
    resolveOutput(output(9));

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual(secondResult);
    expect(runSkillusage).toHaveBeenCalledTimes(1);
  });
});
