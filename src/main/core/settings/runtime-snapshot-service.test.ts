import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isNewerVersion,
  parseCodexVersionInfo,
  parseRuntimeConfigText,
} from './runtime-snapshot-parser';
import { getRuntimeSnapshot } from './runtime-snapshot-service';

const mocks = vi.hoisted(() => ({
  getDependencyManager: vi.fn(),
  getRuntimeConfig: vi.fn(),
}));

vi.mock('@main/core/dependencies/dependency-manager', () => ({
  getDependencyManager: mocks.getDependencyManager,
}));

vi.mock('./runtime-settings-service', () => ({
  runtimeOverrideSettings: {
    getItem: mocks.getRuntimeConfig,
  },
}));

beforeEach(() => {
  mocks.getDependencyManager.mockReset();
  mocks.getRuntimeConfig.mockReset();
  mocks.getDependencyManager.mockResolvedValue({
    get: vi.fn(() => ({
      id: 'codex',
      category: 'agent',
      status: 'available',
      version: '0.144.1',
      path: '/remote/bin/codex',
      checkedAt: 1,
    })),
    probe: vi.fn(),
  });
  mocks.getRuntimeConfig.mockResolvedValue(undefined);
});

describe('runtime snapshot parsers', () => {
  it('extracts only the effective model metadata from TOML', () => {
    expect(
      parseRuntimeConfigText(
        '/tmp/config.toml',
        ['model = "gpt-5.6-codex"', 'model_provider = "openai"', 'api_key = "must-not-leak"'].join(
          '\n'
        )
      )
    ).toEqual({ model: 'gpt-5.6-codex', provider: 'openai' });
  });

  it('returns an empty safe summary for malformed config', () => {
    expect(parseRuntimeConfigText('/tmp/config.json', '{not-json')).toEqual({
      model: null,
      provider: null,
    });
  });

  it('reads the lightweight Codex update cache and tolerates corruption', () => {
    expect(
      parseCodexVersionInfo(
        JSON.stringify({ latest_version: '0.144.1', last_checked_at: '2026-07-10T00:00:00Z' })
      )
    ).toEqual({ latestVersion: '0.144.1', lastCheckedAt: '2026-07-10T00:00:00Z' });
    expect(parseCodexVersionInfo('nope')).toEqual({ latestVersion: null, lastCheckedAt: null });
  });

  it('compares different-length CLI versions numerically', () => {
    expect(isNewerVersion('0.145.0', '0.144.9')).toBe(true);
    expect(isNewerVersion('0.144.1', '0.144.1')).toBe(false);
    expect(isNewerVersion('1.2', '1.2.0')).toBe(false);
  });

  it('does not expose a local native config path for a remote runtime', async () => {
    const snapshot = await getRuntimeSnapshot('codex', { connectionId: 'ssh-1' });

    expect(mocks.getDependencyManager).toHaveBeenCalledWith('ssh-1');
    expect(snapshot.config.path).toBeNull();
    expect(snapshot.config.exists).toBeNull();
    expect(snapshot.model.nativeModel).toBeNull();
    expect(snapshot.model.provider).toBeNull();
  });
});
