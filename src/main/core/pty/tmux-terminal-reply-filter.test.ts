import { describe, expect, it } from 'vitest';
import { TmuxTerminalReplyFilter } from './tmux-terminal-reply-filter';

const DA_PRIMARY_REPLY = '\x1b[?1;2c';
const DA_SECONDARY_REPLY = '\x1b[>0;276;0c';
const XTVERSION_REPLY = '\x1bP>|xterm.js(6.1.0-beta.292)\x1b\\';

describe('TmuxTerminalReplyFilter', () => {
  it('removes primary, secondary, and XTVERSION replies from mixed input', () => {
    const filter = new TmuxTerminalReplyFilter();

    expect(
      filter.feed(`before${DA_PRIMARY_REPLY}${DA_SECONDARY_REPLY}${XTVERSION_REPLY}after`)
    ).toBe('beforeafter');
  });

  it('removes replies split after their distinctive protocol prefixes', () => {
    const filter = new TmuxTerminalReplyFilter();

    expect(filter.feed(`a\x1b[>0;`)).toBe('a');
    expect(filter.feed('276;0c')).toBe('');
    expect(filter.feed('\x1bP>|xterm.js(6.1.0-')).toBe('');
    expect(filter.feed('beta.292)\x1b\\b')).toBe('b');
  });

  it('preserves ordinary escape keys and similar non-reply control sequences', () => {
    const filter = new TmuxTerminalReplyFilter();
    const input = '\x1b\x1b[D\x1b[?25;1$y\x1bP>|another-terminal(1.0)\x1b\\';

    expect(filter.feed(input)).toBe(input);
    expect(filter.flush()).toBe('');
  });

  it('bounds malformed unterminated replies and releases their original bytes', () => {
    const filter = new TmuxTerminalReplyFilter();
    const input = `\x1bP>|xterm.js(${'x'.repeat(600)}`;

    expect(filter.feed(input)).toBe(input);
    expect(filter.flush()).toBe('');
  });

  it('can release a final incomplete reply candidate during teardown', () => {
    const filter = new TmuxTerminalReplyFilter();

    expect(filter.feed('\x1b[>0;276')).toBe('');
    expect(filter.flush()).toBe('\x1b[>0;276');
  });
});
