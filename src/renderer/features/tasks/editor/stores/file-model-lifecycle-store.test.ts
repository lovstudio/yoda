import { describe, expect, it, vi } from 'vitest';
import { rpc } from '@renderer/lib/ipc';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { FileModelLifecycleStore, type FileTabsHost } from './file-model-lifecycle-store';

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
    invalidateModel: vi.fn(() => Promise.resolve(true)),
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

  it('refreshes a text file from its disk model', async () => {
    const store = new FileModelLifecycleStore(makeTabManager(), 'project-1', 'workspace-1');

    await store.refreshFile('src/main.ts');

    expect(modelRegistry.invalidateModel).toHaveBeenCalledWith(
      'disk:file:///workspace%3Aworkspace-1/src/main.ts'
    );
    store.dispose();
  });

  it('refreshes image content from the filesystem', async () => {
    vi.mocked(rpc.fs.readImage).mockResolvedValueOnce({
      success: true,
      data: { success: true, dataUrl: 'data:image/png;base64,refreshed' },
    });
    const tabManager = makeTabManager();
    const store = new FileModelLifecycleStore(tabManager, 'project-1', 'workspace-1');

    await store.refreshFile('image.png');

    expect(tabManager.setImageContent).toHaveBeenCalledWith(
      'image.png',
      'data:image/png;base64,refreshed'
    );
    store.dispose();
  });
});

function makeTabManager(): FileTabsHost {
  return {
    openFilePaths: [],
    activeFileEntry: null,
    setImageContent: vi.fn<(filePath: string, content: string) => void>(),
    updateRenderer: vi.fn(),
    setFileTotalSize: vi.fn(),
  };
}
