import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import { describe, expect, it } from 'vitest';
import { getTerminalFileLinkAtCell } from '@renderer/lib/pty/terminal-file-links';
import {
  getTerminalLinkTargetAtCell,
  registerTerminalLinkProviders,
} from '@renderer/lib/pty/terminal-link-resolver';
import { makeTerminal } from './helpers/mock-terminal';

describe('terminal link resolver', () => {
  const makeWrappedUrlTable = (): { lines: string[]; terminal: Terminal } => {
    const columnWidths = [60, 54, 68] as const;
    const tableRow = (author: string, subject: string, detail: string) =>
      `${author.padEnd(columnWidths[0])}   ${subject.padEnd(columnWidths[1])}   ${detail}`;
    const separator = columnWidths.map((width) => '─'.repeat(width)).join('   ');
    const lines = [
      separator,
      tableRow(
        'Hamel Husain (https://hamel.dev/blog/',
        'AI 产品评测、生产落地',
        '非常务实，强调真实数据'
      ),
      tableRow('secret.html)', '', '《Your AI Product Needs Evals》'),
      separator,
    ];
    return {
      lines,
      terminal: makeTerminal(lines, { cols: lines[0].length }),
    };
  };

  it('prefers the complete URL when its wrapped tail also looks like a file', () => {
    const { lines, terminal } = makeWrappedUrlTable();
    const fileOptions = {
      workspaceRoot: '/workspace',
      onOpen: (): void => undefined,
    };
    const position = { x: lines[2].indexOf('secret.html') + 1, y: 3 };

    expect(getTerminalFileLinkAtCell(terminal, 3, position, fileOptions)?.text).toBe('secret.html');
    expect(getTerminalLinkTargetAtCell(terminal, 3, position, fileOptions)).toEqual({
      kind: 'url',
      url: 'https://hamel.dev/blog/secret.html',
    });
  });

  it('registers the web provider ahead of the overlapping file provider', () => {
    const { terminal: baseTerminal } = makeWrappedUrlTable();
    const providers: ILinkProvider[] = [];
    const terminal = Object.assign(baseTerminal, {
      registerLinkProvider: (provider: ILinkProvider) => {
        providers.push(provider);
        return { dispose: (): void => undefined };
      },
    });

    registerTerminalLinkProviders(
      terminal,
      () => ({
        workspaceRoot: '/workspace',
        onOpen: (): void => undefined,
      }),
      () => ({ onOpen: (): void => undefined })
    );

    const providedLinks: Array<ILink[] | undefined> = [];
    for (const provider of providers) {
      provider.provideLinks(3, (links) => providedLinks.push(links));
    }

    expect(providedLinks[0]?.map((link) => link.text)).toContain(
      'https://hamel.dev/blog/secret.html'
    );
    expect(providedLinks[1]?.map((link) => link.text)).toContain('secret.html');
  });

  it('falls back to a genuine file when there is no enclosing URL', () => {
    const line = '修改 src/renderer/main.tsx';
    const terminal = makeTerminal([line]);
    const fileOptions = {
      workspaceRoot: '/workspace',
      onOpen: (): void => undefined,
    };
    const position = { x: line.indexOf('src/renderer/main.tsx') + 1, y: 1 };

    expect(getTerminalLinkTargetAtCell(terminal, 1, position, fileOptions)).toEqual({
      kind: 'file',
      target: {
        originalText: 'src/renderer/main.tsx',
        filePath: 'src/renderer/main.tsx',
        absolutePath: '/workspace/src/renderer/main.tsx',
        line: undefined,
        column: undefined,
      },
    });
  });
});
