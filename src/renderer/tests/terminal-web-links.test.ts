import { describe, expect, it } from 'vitest';
import { extractTerminalWebLinkCandidates } from '@renderer/lib/pty/terminal-web-links';

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
});
