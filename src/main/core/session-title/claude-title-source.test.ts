import { describe, expect, it } from 'vitest';
import { encodeClaudeProjectDir } from './claude-title-source';

/**
 * The slug rule belongs to Claude Code, not to us — a drift here reads an empty
 * transcript instead of failing, so pin the cases that a separator-only encoder
 * used to get wrong.
 */
describe('encodeClaudeProjectDir', () => {
  it('replaces every non-alphanumeric character, not just separators', () => {
    expect(encodeClaudeProjectDir('/Users/mark/yoda/repositories/手工川ai剪辑')).toBe(
      '-Users-mark-yoda-repositories----ai--'
    );
    expect(encodeClaudeProjectDir('/Users/mark/.claude')).toBe('-Users-mark--claude');
    expect(encodeClaudeProjectDir('/Users/mark/my_repo')).toBe('-Users-mark-my-repo');
  });

  it('truncates long slugs and appends a hash of the raw path', () => {
    const base = `/Users/mark/${'a'.repeat(210)}`;
    const encoded = encodeClaudeProjectDir(base);
    expect(encoded.slice(0, 200)).toBe(base.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 200));
    expect(encoded).toMatch(/^.{200}-[0-9a-z]+$/);
    expect(encodeClaudeProjectDir(`${base}b`)).not.toBe(encoded);
  });
});
