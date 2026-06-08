import { describe, expect, it, vi } from 'vitest';
import type { TabManagerStore } from '@renderer/features/tasks/tabs/tab-manager-store';
import { FileModelLifecycleStore } from './file-model-lifecycle-store';

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    editorBuffer: {
      clearBuffer: vi.fn(),
      listBuffers: vi.fn(() => Promise.resolve([])),
    },
    fs: {
      readImage: vi.fn(),
    },
  },
}));

vi.mock('@renderer/lib/monaco/monaco-model-registry', () => ({
  modelRegistry: {
    getModelByUri: vi.fn(),
    hasPendingConflict: vi.fn(() => false),
    isDirty: vi.fn(() => false),
    modelStatus: new Map<string, string>(),
    modelTotalSizes: new Map<string, number>(),
    registerModel: vi.fn(() => Promise.resolve()),
    reloadFromDisk: vi.fn(),
    saveFileToDisk: vi.fn(() => Promise.resolve(null)),
    toDiskUri: vi.fn((uri: string) => `disk:${uri}`),
    toGitUri: vi.fn((uri: string, ref: string) => `git:${ref}:${uri}`),
    unregisterModel: vi.fn(),
  },
}));

describe('FileModelLifecycleStore', () => {
  it('restores expanded file tree paths into the observable set', () => {
    const store = new FileModelLifecycleStore(makeTabManager(), 'project-1', 'workspace-1');
    store.expandedPaths.add('old');

    expect(() => store.restoreSnapshot({ expandedPaths: ['src', 'src/renderer'] })).not.toThrow();

    expect([...store.expandedPaths]).toEqual(['src', 'src/renderer']);

    store.dispose();
  });
});

function makeTabManager(): TabManagerStore {
  return {
    openFilePaths: [],
  } as unknown as TabManagerStore;
}
