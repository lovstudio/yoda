import { describe, expect, it } from 'vitest';
import {
  resolveTerminalFileHandler,
  type TerminalLinkOpenSettings,
} from '@shared/terminal-settings';
import {
  buildTerminalFileLinkOpenRequest,
  getTerminalFileLinkInternalDestination,
} from './terminal-file-link-open';
import type { TerminalFileLinkOptions } from './terminal-file-links';

const options: TerminalFileLinkOptions = {
  workspaceRoot: '/project',
  onOpen: () => {},
};

describe('terminal link file handler', () => {
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

  it('leaves the target to the surface when the handler is Yoda', () => {
    expect(
      buildTerminalFileLinkOpenRequest(
        'yoda',
        { originalText: 'src/main.ts', absolutePath: '/project/src/main.ts' },
        options
      )
    ).toBeNull();
  });

  it('builds a system request that keeps the line through VS Code', () => {
    expect(
      buildTerminalFileLinkOpenRequest(
        'system',
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

  it('builds a request for the named app', () => {
    expect(
      buildTerminalFileLinkOpenRequest(
        'cursor',
        { originalText: 'src/main.ts', absolutePath: '/project/src/main.ts' },
        options
      )
    ).toMatchObject({ app: 'cursor', path: '/project/src/main.ts' });
  });

  it('falls back to Yoda when the named app cannot reach the remote host', () => {
    expect(
      buildTerminalFileLinkOpenRequest(
        'finder',
        { originalText: '/remote/report.md', absolutePath: '/remote/report.md' },
        { sshConnectionId: 'ssh-1' }
      )
    ).toBeNull();
  });

  it('keeps the surface behavior when no absolute path is available', () => {
    expect(
      buildTerminalFileLinkOpenRequest(
        'system',
        { originalText: 'src/main.ts', filePath: 'src/main.ts' },
        options
      )
    ).toBeNull();
  });
});

describe('resolveTerminalFileHandler', () => {
  const settings = (fileRules: TerminalLinkOpenSettings['fileRules']) => ({
    file: 'yoda' as const,
    url: 'yoda' as const,
    fileRules,
  });

  it('falls back to the file default when no rule matches', () => {
    expect(
      resolveTerminalFileHandler(settings([{ extensions: ['png'], handler: 'system' }]), 'a.ts')
    ).toBe('yoda');
  });

  it('matches case-insensitively and tolerates a leading dot in the rule', () => {
    expect(
      resolveTerminalFileHandler(
        settings([{ extensions: ['.PNG'], handler: 'system' }]),
        '/tmp/Shot.png'
      )
    ).toBe('system');
  });

  it('matches a multi-part extension without extra syntax', () => {
    expect(
      resolveTerminalFileHandler(
        settings([{ extensions: ['tar.gz'], handler: 'finder' }]),
        'dist/app.tar.gz'
      )
    ).toBe('finder');
  });

  it('lets the first matching rule win', () => {
    expect(
      resolveTerminalFileHandler(
        settings([
          { extensions: ['ts'], handler: 'cursor' },
          { extensions: ['ts'], handler: 'system' },
        ]),
        'src/main.ts'
      )
    ).toBe('cursor');
  });
});
