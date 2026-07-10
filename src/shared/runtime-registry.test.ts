import { describe, expect, it } from 'vitest';
import { getUpdateCommandForRuntime } from './runtime-registry';

describe('runtime update commands', () => {
  it('returns an explicitly registered runtime-native update command', () => {
    expect(getUpdateCommandForRuntime('codex')).toBe('codex update');
  });

  it('does not fall back to an install command', () => {
    expect(getUpdateCommandForRuntime('claude')).toBeNull();
  });
});
