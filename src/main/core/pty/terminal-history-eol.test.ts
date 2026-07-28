import { describe, expect, it } from 'vitest';
import { normalizePlainTextTerminalEol } from './terminal-history-eol';

describe('normalizePlainTextTerminalEol', () => {
  it('converts transcript LF separators without duplicating existing carriage returns', () => {
    expect(normalizePlainTextTerminalEol('one\ntwo\r\nthree\rfour')).toBe(
      'one\r\ntwo\r\nthree\rfour'
    );
  });
});
