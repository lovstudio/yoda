import { describe, expect, it } from 'vitest';
import {
  buildTerminalFileLinkExternalOpenRequest,
  getTerminalFileLinkInternalDestination,
} from './terminal-file-link-open';
import type { TerminalFileLinkOptions } from './terminal-file-links';

const options: TerminalFileLinkOptions = {
  workspaceRoot: '/project',
  onOpen: () => {},
};

describe('terminal smart path open mode', () => {
  it('opens a local absolute file inside Yoda', () => {
    expect(
      getTerminalFileLinkInternalDestination(
        { originalText: '/tmp/report.md', absolutePath: '/tmp/report.md' },
        options
      )
    ).toEqual({ path: '/tmp/report.md', placement: 'global' });
  });

  it('keeps workspace-relative paths internal for remote sessions', () => {
    expect(
      getTerminalFileLinkInternalDestination(
        {
          originalText: 'src/main.ts',
          filePath: 'src/main.ts',
          absolutePath: '/remote/project/src/main.ts',
        },
        { sshConnectionId: 'ssh-1' }
      )
    ).toEqual({ path: 'src/main.ts', placement: 'workspace' });
  });

  it('does not route a remote out-of-workspace absolute file into a local Yoda view', () => {
    expect(
      getTerminalFileLinkInternalDestination(
        { originalText: '/remote/report.md', absolutePath: '/remote/report.md' },
        { sshConnectionId: 'ssh-1' }
      )
    ).toBeNull();
  });

  it('keeps directories with the platform file manager', () => {
    expect(
      getTerminalFileLinkInternalDestination(
        { originalText: '/tmp/output/', absolutePath: '/tmp/output/', isDirectory: true },
        options
      )
    ).toBeNull();
  });

  it('keeps the default internal behavior inside Yoda', () => {
    expect(
      buildTerminalFileLinkExternalOpenRequest(
        'internal',
        { originalText: 'src/main.ts', absolutePath: '/project/src/main.ts' },
        options
      )
    ).toBeNull();
  });

  it('builds an external request when that preference is selected', () => {
    expect(
      buildTerminalFileLinkExternalOpenRequest(
        'external',
        {
          originalText: 'src/main.ts:12:3',
          absolutePath: '/project/src/main.ts',
          line: 12,
          column: 3,
        },
        options
      )
    ).toMatchObject({
      app: 'vscode',
      path: '/project/src/main.ts',
      line: 12,
      column: 3,
    });
  });

  it('keeps the surface behavior when no absolute path is available', () => {
    expect(
      buildTerminalFileLinkExternalOpenRequest(
        'external',
        { originalText: 'src/main.ts', filePath: 'src/main.ts' },
        options
      )
    ).toBeNull();
  });
});
