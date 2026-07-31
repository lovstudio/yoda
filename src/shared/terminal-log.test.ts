import { describe, expect, it } from 'vitest';
import { formatTerminalLogContent } from './terminal-log';

describe('formatTerminalLogContent', () => {
  it('keeps readable output while removing terminal-only control sequences', () => {
    const raw =
      '\x1b]0;Terminal title\x07\x1b[32mready\x1b[0m\r\n' +
      'progress 1%\rprogress 100%\n' +
      '\x1bPignored device payload\x1b\\done\t42\x08';

    expect(formatTerminalLogContent(raw)).toBe('ready\nprogress 1%\nprogress 100%\ndone\t42');
  });
});
