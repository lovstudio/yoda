import { describe, expect, it } from 'vitest';
import {
  getRuntimeAccountProfile,
  getUninstallCommandForRuntime,
  getUpdateCommandForRuntime,
  isValidRuntimeId,
  RUNTIME_IDS,
  RUNTIMES,
} from './runtime-registry';

describe('built-in runtimes', () => {
  it.each(['step', 'glm'] as const)(
    'does not register %s because it has no standalone coding agent CLI',
    (id) => {
      expect(RUNTIME_IDS).not.toContain(id);
      expect(RUNTIMES.map((runtime) => runtime.id)).not.toContain(id);
      expect(isValidRuntimeId(id)).toBe(false);
    }
  );
});

describe('runtime update commands', () => {
  it('returns an explicitly registered runtime-native update command', () => {
    expect(getUpdateCommandForRuntime('codex')).toBe('codex update');
  });

  it('does not fall back to an install command', () => {
    expect(getUpdateCommandForRuntime('claude')).toBeNull();
  });
});

describe('runtime uninstall commands', () => {
  it('returns package-manager uninstall commands when they are reliable', () => {
    expect(getUninstallCommandForRuntime('codex')).toBe('npm uninstall -g @openai/codex');
    expect(getUninstallCommandForRuntime('kimi')).toBe('uv tool uninstall kimi-cli');
  });

  it('does not guess how to remove installer-script runtimes', () => {
    expect(getUninstallCommandForRuntime('claude')).toBeNull();
  });
});

describe('runtime subscription usage pages', () => {
  it.each([
    ['codex', 'https://chatgpt.com/codex/settings/usage'],
    ['claude', 'https://claude.ai/settings/usage'],
  ] as const)('returns the official %s usage page', (runtimeId, expectedUrl) => {
    expect(getRuntimeAccountProfile(runtimeId).officialSubscription.usageUrl).toBe(expectedUrl);
  });

  it('leaves the usage page unset when no official destination is registered', () => {
    expect(getRuntimeAccountProfile('opencode').officialSubscription.usageUrl).toBeUndefined();
  });
});
