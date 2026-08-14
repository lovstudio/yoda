import { describe, expect, it } from 'vitest';
import {
  getDefaultPermissionModeId,
  getNpmPackageForRuntime,
  getRuntimeAccountProfile,
  getRuntimePermissionModes,
  getUninstallCommandForRuntime,
  getUpdateCommandForRuntime,
  getVersionHistoryUrlForRuntime,
  isValidRuntimeId,
  resolveRuntimePermissionModeId,
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
    expect(getUpdateCommandForRuntime('claude')).toBe('claude update');
  });

  it('does not fall back to an install command', () => {
    expect(getUpdateCommandForRuntime('cursor')).toBeNull();
  });
});

describe('runtime version history', () => {
  it('returns the registered official Codex release archive', () => {
    expect(getVersionHistoryUrlForRuntime('codex')).toBe(
      'https://github.com/openai/codex/releases'
    );
  });

  it('returns the registered official Claude Code release archive', () => {
    expect(getVersionHistoryUrlForRuntime('claude')).toBe(
      'https://github.com/anthropics/claude-code/releases'
    );
  });

  it('does not guess a release archive from a documentation URL', () => {
    expect(getVersionHistoryUrlForRuntime('cursor')).toBeNull();
  });
});

describe('runtime npm packages', () => {
  it('reads the package back from a registered npm install command', () => {
    expect(getNpmPackageForRuntime('codex')).toBe('@openai/codex');
    expect(getNpmPackageForRuntime('gemini')).toBe('@google/gemini-cli');
    expect(getNpmPackageForRuntime('opencode')).toBe('opencode-ai');
  });

  it('keeps an explicit package for a CLI installed by a shell script', () => {
    expect(getNpmPackageForRuntime('claude')).toBe('@anthropic-ai/claude-code');
  });

  it('does not invent a package for CLIs that npm does not publish', () => {
    expect(getNpmPackageForRuntime('droid')).toBeNull();
    expect(getNpmPackageForRuntime('kimi')).toBeNull();
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

describe('runtime permission defaults', () => {
  it('uses Codex official approval and sandbox flags', () => {
    const modes = new Map(getRuntimePermissionModes('codex').map((mode) => [mode.id, mode]));

    expect(modes.get('default')?.args).toEqual([
      '--sandbox',
      'workspace-write',
      '--ask-for-approval',
      'on-request',
    ]);
    expect(modes.get('plan')?.args).toEqual([
      '--sandbox',
      'read-only',
      '--ask-for-approval',
      'never',
    ]);
    expect(modes.get('full-auto')?.args).toEqual(['--approve-for-me']);
    expect(modes.get('bypass')?.args).toEqual(['--dangerously-bypass-approvals-and-sandbox']);
  });

  it('uses the persisted runtime selection for new sessions', () => {
    expect(
      resolveRuntimePermissionModeId({
        runtimeId: 'codex',
        selections: { codex: 'bypass' },
      })
    ).toBe('bypass');
  });

  it('maps the legacy auto-approve setting to the danger mode', () => {
    expect(
      resolveRuntimePermissionModeId({
        runtimeId: 'codex',
        legacyAutoApprove: { codex: true },
      })
    ).toBe('bypass');
  });

  it('keeps the runtime registry default when no setting exists', () => {
    expect(getDefaultPermissionModeId('codex')).toBe('default');
    expect(resolveRuntimePermissionModeId({ runtimeId: 'codex' })).toBe('default');
  });
});
