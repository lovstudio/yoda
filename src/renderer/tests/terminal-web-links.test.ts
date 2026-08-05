import { describe, expect, it } from 'vitest';
import {
  extractTerminalWebLinkCandidates,
  getTerminalWebLinkAtCell,
  getTerminalWebLinkMatches,
} from '@renderer/lib/pty/terminal-web-links';
import { makeTerminal } from './helpers/mock-terminal';

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

  it('leaves local file URIs to the file link provider', () => {
    const line =
      'file:///Users/mark/.codex/generated_images/019fcba6-bfdb-7063-bde0-3b7def1f9245/exec-de539056-b836-40a4-afeb-fc4e247d8e87.png';

    expect(extractTerminalWebLinkCandidates(line)).toEqual([]);
  });

  it('stops a parenthesized URL before adjacent Chinese prose', () => {
    const url = 'https://lovstudio.ai/yoda/session/yss_jwNYhuQC7vOzOuHim41RoMtQgkVwnMxkxOu8T0p5Z6Y';
    const line = `这条会话 (${url})现在会：`;

    expect(extractTerminalWebLinkCandidates(line)).toEqual([
      { url, index: line.indexOf(url), length: url.length },
    ]);
  });

  it('keeps balanced ASCII delimiters that belong to the URL', () => {
    const url = 'https://en.wikipedia.org/wiki/Function_(mathematics)?range=[0,1]&set={real}';
    const line = `see (${url}) now`;

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

  it.each([
    ['full-width parentheses', '（', '）'],
    ['ASCII parentheses', '(', ')'],
  ])('joins a hard-wrapped final URL segment before its closing %s', (_label, opener, closer) => {
    const terminal = makeTerminal([
      `王树义${opener}https://blog.sciencenet.cn/u/`,
      `wshuyi${closer}`,
    ]);

    for (const bufferLineNumber of [1, 2]) {
      expect(
        getTerminalWebLinkMatches(terminal, bufferLineNumber).map((match) => match.url)
      ).toEqual(['https://blog.sciencenet.cn/u/wshuyi']);
    }
  });

  it('keeps an early-wrapped final URL segment in the selected link', () => {
    const firstLine = 'Hamel Husain (https://hamel.dev/blog/';
    const secondLine = 'secret.html)';
    const url = 'https://hamel.dev/blog/secret.html';
    const terminal = makeTerminal([firstLine, secondLine], { cols: 80 });

    expect(
      getTerminalWebLinkAtCell(terminal, 1, { x: firstLine.indexOf('https') + 1, y: 1 })?.url
    ).toBe(url);
    expect(getTerminalWebLinkAtCell(terminal, 2, { x: 1, y: 2 })?.url).toBe(url);
  });

  it('recognizes every fragment of URLs wrapped across terminal table cells', () => {
    const columnWidths = [60, 54, 68] as const;
    const tableRow = (author: string, subject: string, detail: string) =>
      `${author.padEnd(columnWidths[0])}   ${subject.padEnd(columnWidths[1])}   ${detail}`;
    const separator = columnWidths.map((width) => '─'.repeat(width)).join('   ');
    const lines = [
      separator,
      tableRow(
        'Simon Willison (https://',
        'Agent 工程、模型实验、工具调用',
        '更新快，亲自验证；他的'
      ),
      tableRow('simonwillison.net/)', '', 'Agentic Engineering Patterns'),
      tableRow('', '', '(https://simonwillison.net/guides/'),
      tableRow('', '', 'agentic-engineering-patterns/what-is-'),
      tableRow('', '', 'agentic-engineering/) 很适合系统阅读'),
      separator,
      tableRow(
        'Hamel Husain (https://hamel.dev/blog/',
        'AI 产品评测、生产落地',
        '非常务实，强调真实数据'
      ),
      tableRow('secret.html)', '', '《Your AI Product Needs Evals》'),
      separator,
    ];
    const terminal = makeTerminal(lines, { cols: lines[0].length });
    const simonUrl = 'https://simonwillison.net/';
    const guideUrl =
      'https://simonwillison.net/guides/agentic-engineering-patterns/what-is-agentic-engineering/';
    const hamelUrl = 'https://hamel.dev/blog/secret.html';
    const linkAt = (lineNumber: number, token: string) =>
      getTerminalWebLinkAtCell(terminal, lineNumber, {
        x: lines[lineNumber - 1].indexOf(token) + 1,
        y: lineNumber,
      });

    expect(linkAt(2, 'https://')?.url).toBe(simonUrl);
    expect(linkAt(3, 'simonwillison.net')?.url).toBe(simonUrl);
    expect(linkAt(4, 'https://')?.url).toBe(guideUrl);
    expect(linkAt(5, 'agentic-engineering-patterns')?.url).toBe(guideUrl);
    expect(linkAt(6, 'agentic-engineering/')?.url).toBe(guideUrl);
    expect(linkAt(8, 'https://hamel.dev')?.url).toBe(hamelUrl);
    expect(linkAt(9, 'secret.html')?.url).toBe(hamelUrl);
    expect(linkAt(2, 'Agent 工程')).toBeNull();
    expect(linkAt(6, '很适合系统阅读')).toBeNull();
  });

  it('does not join a URL into the next Chinese row label', () => {
    const terminal = makeTerminal(
      ['微信读书 (https://weread.qq.com/web/', '得到 (https://www.dedao.cn/ebook/detail)'],
      { cols: 100 }
    );

    expect(getTerminalWebLinkMatches(terminal, 1).map((match) => match.url)).toEqual([
      'https://weread.qq.com/web/',
    ]);
  });

  it('does not join a URL into the next ASCII row label', () => {
    const terminal = makeTerminal(
      [
        '得到 (https://www.dedao.cn/ebook/detail/',
        'Macmillan 官方页 (https://us.macmillan.com/books/9781250897947/theworldsisee/)',
      ],
      { cols: 100 }
    );

    expect(getTerminalWebLinkMatches(terminal, 1).map((match) => match.url)).toEqual([
      'https://www.dedao.cn/ebook/detail/',
    ]);
  });
});
