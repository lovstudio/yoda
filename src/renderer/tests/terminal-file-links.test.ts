import { describe, expect, it } from 'vitest';
import {
  extractTerminalFileLinkCandidates,
  getTerminalFileLinkMatches,
  resolveTerminalFileLinkTarget,
} from '@renderer/lib/pty/terminal-file-links';
import { isTerminalLinkCellInRange } from '@renderer/lib/pty/terminal-link-target';
import { makeTerminal } from './helpers/mock-terminal';

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

  it('extracts a rooted path whose directory segment contains a space', () => {
    const line =
      '- /Users/mark/Library/Application Support/com.lovstudio.ymux/logs/web-1779785445.log:14331 已记录重新编译成功';
    const expected =
      '/Users/mark/Library/Application Support/com.lovstudio.ymux/logs/web-1779785445.log:14331';

    expect(extractTerminalFileLinkCandidates(line)).toEqual([
      { text: expected, index: line.indexOf(expected) },
    ]);
  });

  it('keeps separate rooted paths from being merged through prose', () => {
    const first = '/Users/mark/Library/Application Support/yoda/first.log';
    const second = '/Users/mark/Library/Application Support/yoda/second.log';
    const line = `日志 ${first} and ${second}`;

    expect(extractTerminalFileLinkCandidates(line)).toEqual([
      { text: first, index: line.indexOf(first) },
      { text: second, index: line.indexOf(second) },
    ]);
  });

  it('does not merge an incomplete rooted path through prose into a later path', () => {
    const line = '目录 /Users/mark/foo and /tmp/second.log';
    const expected = '/tmp/second.log';

    expect(extractTerminalFileLinkCandidates(line)).toEqual([
      { text: expected, index: line.indexOf(expected) },
    ]);
  });

  it('does not merge an incomplete absolute path through prose into a relative path', () => {
    const line = '见 /Users/mark/project and src/main/index.ts';
    const expected = 'src/main/index.ts';

    expect(extractTerminalFileLinkCandidates(line)).toEqual([
      { text: expected, index: line.indexOf(expected) },
    ]);
  });

  it('does not merge absolute-path-like prose into a later dot-relative path', () => {
    const line = '说明 /Users are people and ./src/main.ts';
    const expected = './src/main.ts';

    expect(extractTerminalFileLinkCandidates(line)).toEqual([
      { text: expected, index: line.indexOf(expected) },
    ]);
  });

  it('keeps a dotted spaced directory inside one absolute path', () => {
    const line = '日志 /Users/mark/.cache folder/yoda/app.log';
    const expected = '/Users/mark/.cache folder/yoda/app.log';

    expect(extractTerminalFileLinkCandidates(line)).toEqual([
      { text: expected, index: line.indexOf(expected) },
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

  it('extracts ~/ paths terminated by a CJK fullwidth bracket', () => {
    const line =
      '主报告：~/Documents/cli-agent-runtime-research-20260605/手工川-codex-claude-yoda-runtime-2026-06-05-v0.1.md（1036 行）';
    const expected =
      '~/Documents/cli-agent-runtime-research-20260605/手工川-codex-claude-yoda-runtime-2026-06-05-v0.1.md';
    expect(extractTerminalFileLinkCandidates(line)).toEqual([
      { text: expected, index: line.indexOf(expected) },
    ]);
  });

  it('terminates absolute paths at CJK sentence-final punctuation', () => {
    expect(extractTerminalFileLinkCandidates('路径：/Users/foo/bar.txt。')).toEqual([
      { text: '/Users/foo/bar.txt', index: '路径：'.length },
    ]);
  });

  it('drops a trailing sentence period after the extension', () => {
    const line = 'output/手工川-会话实时摘要机制-2026-06-09-v0.1.md.';
    const expected = 'output/手工川-会话实时摘要机制-2026-06-09-v0.1.md';
    expect(extractTerminalFileLinkCandidates(line)).toEqual([{ text: expected, index: 0 }]);
  });

  it('terminates paths at an ASCII paren so trailing prose is not swallowed', () => {
    const line =
      'output/手工川-codex-vs-cc-问卷工具-2026-06-09-v0.1.md(含逐条 file:line 证据 + 置信度表)';
    const expected = 'output/手工川-codex-vs-cc-问卷工具-2026-06-09-v0.1.md';
    expect(extractTerminalFileLinkCandidates(line)).toEqual([{ text: expected, index: 0 }]);
  });

  it('strips ASCII parens wrapping a path', () => {
    const line = '见 (src/foo.ts) 文件';
    expect(extractTerminalFileLinkCandidates(line)).toEqual([
      { text: 'src/foo.ts', index: line.indexOf('src/foo.ts') },
    ]);
  });

  it('keeps interior dots in multi-part extensions', () => {
    expect(extractTerminalFileLinkCandidates('看 output/foo.md.bak 后面')).toEqual([
      { text: 'output/foo.md.bak', index: '看 '.length },
    ]);
  });

  it('extracts trailing-slash directory paths', () => {
    const line = '产物目录：output/slide-deck/moments-chronicle/';
    const expected = 'output/slide-deck/moments-chronicle/';
    expect(extractTerminalFileLinkCandidates(line)).toEqual([
      { text: expected, index: line.indexOf(expected) },
    ]);
  });

  it('extracts a single-segment directory after a command', () => {
    expect(extractTerminalFileLinkCandidates('cd src/ && ls')).toEqual([
      { text: 'src/', index: 'cd '.length },
    ]);
  });

  it('does not match a multi-segment path without an extension or trailing slash', () => {
    expect(extractTerminalFileLinkCandidates('see src/main here')).toEqual([]);
  });

  it('leaves absolute paths without spaces to the strict matcher', () => {
    const expected = '/foo/./bar.ts';

    expect(extractTerminalFileLinkCandidates(`see ${expected}`)).toEqual([
      { text: expected, index: 'see '.length },
    ]);
  });

  it('resolves a workspace-relative directory to its folder (no filePath)', () => {
    expect(
      resolveTerminalFileLinkTarget('output/slide-deck/moments-chronicle/', '/Users/mark/project')
    ).toEqual({
      originalText: 'output/slide-deck/moments-chronicle/',
      isDirectory: true,
      absolutePath: '/Users/mark/project/output/slide-deck/moments-chronicle',
    });
  });

  it('resolves an absolute directory outside the workspace', () => {
    expect(resolveTerminalFileLinkTarget('/tmp/outside/', '/Users/mark/project')).toEqual({
      originalText: '/tmp/outside/',
      isDirectory: true,
      absolutePath: '/tmp/outside',
    });
  });

  it('normalizes workspace-relative paths', () => {
    expect(resolveTerminalFileLinkTarget('./poster/../poster/index.html')).toEqual({
      originalText: './poster/../poster/index.html',
      filePath: 'poster/index.html',
      absolutePath: undefined,
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
      absolutePath: '/Users/mark/project/poster/product-matrix/index.html',
      line: 5,
      column: undefined,
    });
  });

  it('maps absolute paths from the main checkout into the active worktree', () => {
    expect(
      resolveTerminalFileLinkTarget(
        '/Users/mark/lovstudio/coding/yoda/src/renderer/tests/terminal-file-links.test.ts:31',
        '/Users/mark/lovstudio/coding/yoda/.worktrees/hr2ln',
        undefined,
        ['/Users/mark/lovstudio/coding/yoda']
      )
    ).toEqual({
      originalText:
        '/Users/mark/lovstudio/coding/yoda/src/renderer/tests/terminal-file-links.test.ts:31',
      filePath: 'src/renderer/tests/terminal-file-links.test.ts',
      absolutePath:
        '/Users/mark/lovstudio/coding/yoda/.worktrees/hr2ln/src/renderer/tests/terminal-file-links.test.ts',
      line: 31,
      column: undefined,
    });
  });

  it.each([
    {
      workspaceRoot: '/Users/mark/lovstudio/coding/yoda/.worktrees/hr2ln',
      relativePath: '.git/config',
    },
    {
      workspaceRoot: '/Users/mark/lovstudio/coding/yoda/.worktrees/hr2ln',
      relativePath: '.worktrees/another/src/main/index.ts',
    },
    {
      workspaceRoot: '/Users/mark/lovstudio/coding/yoda/.yoda/worktrees/hr2ln',
      relativePath: '.yoda/worktrees/another/src/main/index.ts',
    },
    {
      workspaceRoot: '/Users/mark/lovstudio/coding/yoda/custom-pool/hr2ln',
      relativePath: 'custom-pool/another/src/main/index.ts',
    },
  ])(
    'does not map checkout metadata path $relativePath through a workspace alias',
    ({ workspaceRoot, relativePath }) => {
      const text = `/Users/mark/lovstudio/coding/yoda/${relativePath}:12`;

      expect(
        resolveTerminalFileLinkTarget(text, workspaceRoot, undefined, [
          '/Users/mark/lovstudio/coding/yoda',
        ])
      ).toEqual({
        originalText: text,
        absolutePath: `/Users/mark/lovstudio/coding/yoda/${relativePath}`,
        line: 12,
        column: undefined,
      });
    }
  );

  it('strips mention prefixes when resolving source links', () => {
    expect(resolveTerminalFileLinkTarget('@src/main/index.ts:12:3')).toEqual({
      originalText: '@src/main/index.ts:12:3',
      filePath: 'src/main/index.ts',
      absolutePath: undefined,
      line: 12,
      column: 3,
    });
  });

  it('preserves absolute paths outside the workspace root as absolutePath only', () => {
    expect(resolveTerminalFileLinkTarget('/tmp/outside/file.html', '/Users/mark/project')).toEqual({
      originalText: '/tmp/outside/file.html',
      absolutePath: '/tmp/outside/file.html',
      line: undefined,
      column: undefined,
    });
  });

  it('expands ~/ paths against the home dir', () => {
    expect(resolveTerminalFileLinkTarget('~/Documents/foo.md:3', undefined, '/Users/mark')).toEqual(
      {
        originalText: '~/Documents/foo.md:3',
        absolutePath: '/Users/mark/Documents/foo.md',
        line: 3,
        column: undefined,
      }
    );
  });

  it('returns null for ~/ paths when no home dir is provided', () => {
    expect(resolveTerminalFileLinkTarget('~/Documents/foo.md')).toBeNull();
  });

  it('recognizes the complete hard-wrapped path with a spaced directory from either row', () => {
    const terminal = makeTerminal([
      '- /Users/mark/Library/Application Support/com.lovstudio.ymux/logs/web-',
      '1779785445.log:14331 已记录重新编译成功后续 200',
    ]);
    const text =
      '/Users/mark/Library/Application Support/com.lovstudio.ymux/logs/web-1779785445.log:14331';
    const expected = {
      range: { start: { x: 3, y: 1 }, end: { x: 20, y: 2 } },
      text,
      target: {
        originalText: text,
        absolutePath:
          '/Users/mark/Library/Application Support/com.lovstudio.ymux/logs/web-1779785445.log',
        line: 14331,
        column: undefined,
      },
    };
    const options = {
      workspaceRoot: '/Users/mark/lovstudio/coding/web',
      onOpen: (): void => undefined,
    };

    expect(getTerminalFileLinkMatches(terminal, 1, options)).toEqual([expected]);
    expect(getTerminalFileLinkMatches(terminal, 2, options)).toEqual([expected]);
  });

  it('keeps a hard-wrapped line suffix attached to the file path', () => {
    const text =
      '/Users/mark/lovstudio/coding/yoda/src/renderer/tests/terminal-file-links.test.ts:31';
    const terminal = makeTerminal([text.slice(0, 80), text.slice(80)]);
    const expected = {
      range: { start: { x: 1, y: 1 }, end: { x: 3, y: 2 } },
      text,
      target: {
        originalText: text,
        filePath: 'src/renderer/tests/terminal-file-links.test.ts',
        absolutePath:
          '/Users/mark/lovstudio/coding/yoda/.worktrees/hr2ln/src/renderer/tests/terminal-file-links.test.ts',
        line: 31,
        column: undefined,
      },
    };
    const options = {
      workspaceRoot: '/Users/mark/lovstudio/coding/yoda/.worktrees/hr2ln',
      workspaceRootAliases: ['/Users/mark/lovstudio/coding/yoda'],
      onOpen: (): void => undefined,
    };

    expect(getTerminalFileLinkMatches(terminal, 1, options)).toEqual([expected]);
    expect(getTerminalFileLinkMatches(terminal, 2, options)).toEqual([expected]);
  });

  it.each([80, 81, 82, 83, 84])(
    'keeps a line and column suffix across a hard wrap at column %i',
    (column) => {
      const text =
        '/Users/mark/lovstudio/coding/yoda/src/renderer/tests/terminal-file-links.test.ts:31:4';
      const terminal = makeTerminal([text.slice(0, column), text.slice(column)]);
      const options = {
        workspaceRoot: '/Users/mark/lovstudio/coding/yoda',
        onOpen: (): void => undefined,
      };

      const matches = getTerminalFileLinkMatches(terminal, 2, options);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe(text);
      expect(matches[0]?.target).toMatchObject({ line: 31, column: 4 });
    }
  );

  it('does not hard-join a complete file path to colon-prefixed prose', () => {
    const path = `${'/very-long-directory'.repeat(4)}/file.ts`;
    const terminal = makeTerminal([path, ': not a line suffix']);
    const options = {
      workspaceRoot: '/Users/mark/lovstudio/coding/yoda',
      onOpen: (): void => undefined,
    };

    expect(getTerminalFileLinkMatches(terminal, 2, options)).toEqual([]);
  });

  it('does not hard-join prose to an independent absolute path with a line suffix', () => {
    const terminal = makeTerminal([`${'a'.repeat(72)} command`, '/tmp/bar.ts:31']);
    const options = {
      workspaceRoot: '/Users/mark/project',
      onOpen: (): void => undefined,
    };

    expect(getTerminalFileLinkMatches(terminal, 2, options)).toEqual([
      {
        range: { start: { x: 1, y: 2 }, end: { x: 14, y: 2 } },
        text: '/tmp/bar.ts:31',
        target: {
          originalText: '/tmp/bar.ts:31',
          absolutePath: '/tmp/bar.ts',
          line: 31,
          column: undefined,
        },
      },
    ]);
  });

  it('does not treat a hard-wrapped URL location suffix as a file continuation', () => {
    const terminal = makeTerminal(['http://localhost:3000/src/file.ts', ':31']);
    const options = {
      workspaceRoot: '/Users/mark/project',
      onOpen: (): void => undefined,
    };

    expect(getTerminalFileLinkMatches(terminal, 2, options)).toEqual([]);
  });

  it('recognizes a spaced absolute path across every row of a soft wrap', () => {
    const terminal = makeTerminal([
      '- /Users/mark/Library/Application',
      { text: ' Support/com.lovstudio.ymux/logs/', isWrapped: true },
      { text: 'web.log:12 后续', isWrapped: true },
    ]);
    const text = '/Users/mark/Library/Application Support/com.lovstudio.ymux/logs/web.log:12';
    const expected = {
      range: { start: { x: 3, y: 1 }, end: { x: 10, y: 3 } },
      text,
      target: {
        originalText: text,
        absolutePath: '/Users/mark/Library/Application Support/com.lovstudio.ymux/logs/web.log',
        line: 12,
        column: undefined,
      },
    };
    const options = {
      workspaceRoot: '/Users/mark/lovstudio/coding/web',
      onOpen: (): void => undefined,
    };

    expect(getTerminalFileLinkMatches(terminal, 1, options)).toEqual([expected]);
    expect(getTerminalFileLinkMatches(terminal, 2, options)).toEqual([expected]);
    expect(getTerminalFileLinkMatches(terminal, 3, options)).toEqual([expected]);
  });

  it('maps a soft-wrapped link starting at the first cell of a row', () => {
    const terminal = makeTerminal([
      `${'a'.repeat(79)}(`,
      { text: 'src/foo.ts rest', isWrapped: true },
    ]);
    const options = {
      workspaceRoot: '/Users/mark/project',
      onOpen: (): void => undefined,
    };

    expect(getTerminalFileLinkMatches(terminal, 2, options)).toEqual([
      {
        range: { start: { x: 1, y: 2 }, end: { x: 10, y: 2 } },
        text: 'src/foo.ts',
        target: {
          originalText: 'src/foo.ts',
          filePath: 'src/foo.ts',
          absolutePath: '/Users/mark/project/src/foo.ts',
          line: undefined,
          column: undefined,
        },
      },
    ]);
  });
});

describe('terminal link target ranges', () => {
  it('matches cells inside a single-line link range', () => {
    const range = { start: { x: 4, y: 2 }, end: { x: 12, y: 2 } };

    expect(isTerminalLinkCellInRange(range, { x: 4, y: 2 })).toBe(true);
    expect(isTerminalLinkCellInRange(range, { x: 12, y: 2 })).toBe(true);
    expect(isTerminalLinkCellInRange(range, { x: 3, y: 2 })).toBe(false);
    expect(isTerminalLinkCellInRange(range, { x: 13, y: 2 })).toBe(false);
  });

  it('matches cells inside a wrapped multi-line link range', () => {
    const range = { start: { x: 10, y: 2 }, end: { x: 6, y: 4 } };

    expect(isTerminalLinkCellInRange(range, { x: 9, y: 2 })).toBe(false);
    expect(isTerminalLinkCellInRange(range, { x: 10, y: 2 })).toBe(true);
    expect(isTerminalLinkCellInRange(range, { x: 1, y: 3 })).toBe(true);
    expect(isTerminalLinkCellInRange(range, { x: 6, y: 4 })).toBe(true);
    expect(isTerminalLinkCellInRange(range, { x: 7, y: 4 })).toBe(false);
  });
});
