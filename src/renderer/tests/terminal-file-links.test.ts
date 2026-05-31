import { describe, expect, it } from 'vitest';
import {
  extractTerminalFileLinkCandidates,
  resolveTerminalFileLinkTarget,
} from '@renderer/lib/pty/terminal-file-links';

describe('terminal file links', () => {
  it('extracts generated artifact paths after Chinese labels', () => {
    const line = '  - 可编辑 HTML：poster/product-matrix/index.html';

    expect(extractTerminalFileLinkCandidates(line)).toEqual([
      {
        text: 'poster/product-matrix/index.html',
        index: line.indexOf('poster/product-matrix/index.html'),
      },
    ]);
  });

  it('extracts paths with line and column suffixes', () => {
    expect(extractTerminalFileLinkCandidates('open src/main/index.ts:12:3 now')).toEqual([
      {
        text: 'src/main/index.ts:12:3',
        index: 'open '.length,
      },
    ]);
  });

  it('extracts source paths with mention prefixes and component breadcrumbs', () => {
    const line =
      '@src/renderer/lib/pty/pane-sizing-context.tsx:195:7(ResizablePanelGroup>ResizablePanel>div>div>div>div>div)';

    expect(extractTerminalFileLinkCandidates(line)).toEqual([
      {
        text: '@src/renderer/lib/pty/pane-sizing-context.tsx:195:7',
        index: 0,
      },
    ]);
  });

  it('normalizes workspace-relative paths', () => {
    expect(resolveTerminalFileLinkTarget('./poster/../poster/index.html')).toEqual({
      originalText: './poster/../poster/index.html',
      filePath: 'poster/index.html',
      line: undefined,
      column: undefined,
    });
  });

  it('converts absolute paths under the workspace root', () => {
    expect(
      resolveTerminalFileLinkTarget(
        '/Users/mark/project/poster/product-matrix/index.html:5',
        '/Users/mark/project'
      )
    ).toEqual({
      originalText: '/Users/mark/project/poster/product-matrix/index.html:5',
      filePath: 'poster/product-matrix/index.html',
      line: 5,
      column: undefined,
    });
  });

  it('strips mention prefixes when resolving source links', () => {
    expect(resolveTerminalFileLinkTarget('@src/main/index.ts:12:3')).toEqual({
      originalText: '@src/main/index.ts:12:3',
      filePath: 'src/main/index.ts',
      line: 12,
      column: 3,
    });
  });

  it('rejects absolute paths outside the workspace root', () => {
    expect(
      resolveTerminalFileLinkTarget('/tmp/outside/file.html', '/Users/mark/project')
    ).toBeNull();
  });
});
