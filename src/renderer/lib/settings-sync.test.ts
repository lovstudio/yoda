import { describe, expect, it, vi } from 'vitest';
import {
  applyPortableRendererStorage,
  collectPortableRendererStorage,
  isPortableRendererStorageKey,
} from './settings-sync';

vi.mock('@renderer/lib/ipc', () => ({ rpc: {} }));

function memoryStorage(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
    values,
  };
}

describe('renderer settings sync storage', () => {
  it('selects portable UI preferences and ignores cache/session state', () => {
    const storage = memoryStorage({
      'yoda-theme': '"ygreen"',
      'yoda:language': 'zh-CN',
      'react-resizable-panels:workspace-outer': '[20,80]',
      'terminal-drawer-inner:task-1': '[30,70]',
      'yoda:update:lastNotified': '0.16.1',
    });
    expect(collectPortableRendererStorage(storage)).toEqual({
      'yoda-theme': '"ygreen"',
      'yoda:language': 'zh-CN',
      'react-resizable-panels:workspace-outer': '[20,80]',
    });
  });

  it('replaces existing portable keys without touching unrelated state', () => {
    const storage = memoryStorage({
      'yoda-theme': 'old',
      'yoda:language': 'en',
      cache: 'keep',
    });
    applyPortableRendererStorage({ 'yoda-theme': 'new' }, storage);
    expect(Object.fromEntries(storage.values)).toEqual({ cache: 'keep', 'yoda-theme': 'new' });
  });

  it('allows runtime account disclosure preferences', () => {
    expect(isPortableRendererStorageKey('yoda:agent-account:expanded:claude')).toBe(true);
    expect(isPortableRendererStorageKey('yoda.skillUsageStats.v2')).toBe(false);
  });
});
