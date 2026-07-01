import type { Terminal } from '@xterm/xterm';
import { describe, expect, it } from 'vitest';
import {
  extractTerminalWebLinkCandidates,
  getTerminalWebLinkMatches,
} from '@renderer/lib/pty/terminal-web-links';

class MockCell {
  private chars = '';
  private width = 1;

  set(chars: string, width: number): void {
    this.chars = chars;
    this.width = width;
  }

  getChars(): string {
    return this.chars;
  }

  getWidth(): number {
    return this.width;
  }
}

class MockBufferLine {
  readonly length: number;
  readonly isWrapped: boolean;

  constructor(
    private readonly text: string,
    options: { isWrapped?: boolean } = {}
  ) {
    this.length = text.length;
    this.isWrapped = options.isWrapped ?? false;
  }

  translateToString(): string {
    return this.text;
  }

  getCell(index: number, cell: MockCell): MockCell {
    const chars = this.text[index] ?? '';
    cell.set(chars, chars ? 1 : 0);
    return cell;
  }
}

function makeTerminal(lines: Array<string | { text: string; isWrapped?: boolean }>): Terminal {
  const bufferLines = lines.map((line) =>
    typeof line === 'string' ? new MockBufferLine(line) : new MockBufferLine(line.text, line)
  );

  return {
    buffer: {
      active: {
        getLine: (index: number) => bufferLines[index],
        getNullCell: () => new MockCell(),
      },
    },
  } as unknown as Terminal;
}

describe('terminal web links', () => {
  it('terminates URLs at CJK punctuation without requiring whitespace', () => {
    const line = ' https://lovstudio.ai/yoda/mobile，可用';
    const url = 'https://lovstudio.ai/yoda/mobile';

    expect(extractTerminalWebLinkCandidates(line)).toEqual([
      { url, index: line.indexOf(url), length: url.length },
    ]);
  });

  it('keeps normal URL query and hash characters', () => {
    const line = 'open https://example.com/path?a=1&b=two#section now';
    const url = 'https://example.com/path?a=1&b=two#section';

    expect(extractTerminalWebLinkCandidates(line)).toEqual([
      { url, index: line.indexOf(url), length: url.length },
    ]);
  });

  it('makes the whole markdown link span clickable and opens the inner URL', () => {
    const line = 'see [Anthropic docs](https://docs.anthropic.com/foo) here';
    const span = '[Anthropic docs](https://docs.anthropic.com/foo)';

    expect(extractTerminalWebLinkCandidates(line)).toEqual([
      { url: 'https://docs.anthropic.com/foo', index: line.indexOf(span), length: span.length },
    ]);
  });

  it('does not emit a duplicate bare-URL link nested inside a markdown link', () => {
    const line = '[x](https://a.com) and https://b.com';

    expect(extractTerminalWebLinkCandidates(line)).toEqual([
      { url: 'https://a.com', index: 0, length: '[x](https://a.com)'.length },
      {
        url: 'https://b.com',
        index: line.indexOf('https://b.com'),
        length: 'https://b.com'.length,
      },
    ]);
  });

  it('starts the markdown span at the bracket for image links', () => {
    const line = '![alt](https://img.example/p.png)';
    const span = '[alt](https://img.example/p.png)';

    expect(extractTerminalWebLinkCandidates(line)).toEqual([
      { url: 'https://img.example/p.png', index: line.indexOf(span), length: span.length },
    ]);
  });

  it('joins hard-wrapped URL continuations that start with URL path characters', () => {
    const terminal = makeTerminal([
      '  (https://www.dedao.cn/ebook/detail?',
      'id=xM6Evn5byxq2PnXBz71AjZao16R8WJrXjmW0KpGkd4gmMLEJrYNQe9VvD8P4jLk)',
    ]);

    expect(getTerminalWebLinkMatches(terminal, 1).map((match) => match.url)).toEqual([
      'https://www.dedao.cn/ebook/detail?id=xM6Evn5byxq2PnXBz71AjZao16R8WJrXjmW0KpGkd4gmMLEJrYNQe9VvD8P4jLk',
    ]);
  });

  it('does not join a URL into the next Chinese row label', () => {
    const terminal = makeTerminal([
      '微信读书 (https://weread.qq.com/web/',
      '得到 (https://www.dedao.cn/ebook/detail)',
    ]);

    expect(getTerminalWebLinkMatches(terminal, 1).map((match) => match.url)).toEqual([
      'https://weread.qq.com/web/',
    ]);
  });
});
