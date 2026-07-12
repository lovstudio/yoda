import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KV } from './kv';

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  deleteWhere: vi.fn(),
}));

vi.mock('./client', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ onConflictDoUpdate: mocks.upsert })),
    })),
    delete: vi.fn(() => ({ where: mocks.deleteWhere })),
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: { error: vi.fn() },
}));

describe('KV strict mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('propagates set failures only through setStrict', async () => {
    mocks.upsert.mockRejectedValue(new Error('database unavailable'));
    const store = new KV<{ state: boolean }>('test');

    await expect(store.setStrict('state', true)).rejects.toThrow('database unavailable');
    await expect(store.set('state', true)).resolves.toBeUndefined();
  });

  it('propagates delete failures only through delStrict', async () => {
    mocks.deleteWhere.mockRejectedValue(new Error('database unavailable'));
    const store = new KV<{ state: boolean }>('test');

    await expect(store.delStrict('state')).rejects.toThrow('database unavailable');
    await expect(store.del('state')).resolves.toBeUndefined();
  });
});
