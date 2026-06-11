import { describe, expect, it, vi } from 'vitest';
import { toWorkspaceRelativePath } from './file-actions';

vi.mock('@renderer/features/tasks/task-view-context', () => ({
  useProvisionedTask: vi.fn(),
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    app: {
      clipboardWriteText: vi.fn(),
      openIn: vi.fn(),
    },
  },
}));

// file-actions reaches appState for the side-pane placement actions; the
// real singleton drags in the whole store graph, which this unit doesn't need.
vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {},
}));

describe('toWorkspaceRelativePath', () => {
  it('returns null when either path is missing', () => {
    expect(toWorkspaceRelativePath(undefined, '/repo')).toBeNull();
    expect(toWorkspaceRelativePath('/repo/src/file.ts', undefined)).toBeNull();
  });

  it('returns a workspace-relative path for files under the workspace root', () => {
    expect(toWorkspaceRelativePath('/repo/src/file.ts', '/repo')).toBe('src/file.ts');
  });
});
