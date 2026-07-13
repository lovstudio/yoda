import { describe, expect, it, vi } from 'vitest';
import {
  buildFilePathDefaultOpenRequest,
  buildFilePathOpenInRequest,
} from '@renderer/lib/components/file-path-open';
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

describe('buildFilePathOpenInRequest', () => {
  it('keeps a VS Code source location separate from a path containing spaces', () => {
    expect(
      buildFilePathOpenInRequest('vscode', {
        absolutePath: '/Users/mark/Project With Spaces/src/main.ts',
        line: 31,
        column: 4,
      })
    ).toEqual({
      app: 'vscode',
      path: '/Users/mark/Project With Spaces/src/main.ts',
      reveal: false,
      isRemote: false,
      sshConnectionId: null,
      line: 31,
      column: 4,
    });
  });

  it('does not attach a source location to a directory request', () => {
    expect(
      buildFilePathOpenInRequest('finder', {
        absolutePath: '/Users/mark/Project With Spaces/',
        kind: 'directory',
        line: 31,
        column: 4,
      })
    ).toEqual({
      app: 'finder',
      path: '/Users/mark/Project With Spaces/',
      reveal: false,
      isRemote: false,
      sshConnectionId: null,
    });
  });

  it('uses VS Code for a line-bearing absolute path opened from the terminal', () => {
    expect(
      buildFilePathDefaultOpenRequest({
        absolutePath:
          '/Users/mark/Library/Application Support/com.lovstudio.ymux/logs/web-1779785445.log',
        line: 14331,
      })
    ).toEqual({
      app: 'vscode',
      path: '/Users/mark/Library/Application Support/com.lovstudio.ymux/logs/web-1779785445.log',
      reveal: false,
      isRemote: false,
      sshConnectionId: null,
      line: 14331,
    });
  });

  it('keeps the OS-default opener for a file without a source location', () => {
    expect(buildFilePathDefaultOpenRequest({ absolutePath: '/tmp/output.log' })).toMatchObject({
      app: 'finder',
      path: '/tmp/output.log',
      reveal: false,
    });
  });
});
