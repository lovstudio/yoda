import { describe, expect, it } from 'vitest';
import { buildTerminalFileLinkExternalOpenRequest } from './terminal-file-link-open';
import type { TerminalFileLinkOptions } from './terminal-file-links';

const options: TerminalFileLinkOptions = {
  workspaceRoot: '/project',
  onOpen: () => {},
};

describe('terminal smart path open mode', () => {
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
