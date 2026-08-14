import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseNpmDistTags } from './runtime-latest-version';
import {
  isNewerVersion,
  parseCodexVersionCache,
  parseRuntimeConfigText,
} from './runtime-snapshot-parser';
import { getRuntimeSnapshot } from './runtime-snapshot-service';

const mocks = vi.hoisted(() => ({
  getDependencyManager: vi.fn(),
  getRuntimeConfig: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('electron', () => ({ net: { fetch: mocks.fetch } }));

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
  mocks.fetch.mockReset();
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
  mocks.fetch.mockRejectedValue(new Error('no network in tests'));
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
      parseCodexVersionCache(
        JSON.stringify({ latest_version: '0.144.1', last_checked_at: '2026-07-10T00:00:00Z' })
      )
    ).toEqual({ latestVersion: '0.144.1', lastCheckedAt: '2026-07-10T00:00:00Z' });
    expect(parseCodexVersionCache('nope')).toEqual({ latestVersion: null, lastCheckedAt: null });
  });

  it('compares different-length CLI versions numerically', () => {
    expect(isNewerVersion('0.145.0', '0.144.9')).toBe(true);
    expect(isNewerVersion('0.144.1', '0.144.1')).toBe(false);
    expect(isNewerVersion('1.2', '1.2.0')).toBe(false);
  });

  it('reads the npm latest dist-tag and ignores prerelease channels', () => {
    expect(parseNpmDistTags({ latest: '2.1.232', next: '2.1.240', alpha: '2.2.0' })).toBe(
      '2.1.232'
    );
    expect(parseNpmDistTags({ next: '2.1.240' })).toBeNull();
    expect(parseNpmDistTags('nope')).toBeNull();
  });

  it('does not expose a local native config path for a remote runtime', async () => {
    const snapshot = await getRuntimeSnapshot('codex', { connectionId: 'ssh-1' });

    expect(mocks.getDependencyManager).toHaveBeenCalledWith('ssh-1');
    expect(snapshot.config.path).toBeNull();
    expect(snapshot.config.exists).toBeNull();
    expect(snapshot.model.nativeModel).toBeNull();
    expect(snapshot.model.provider).toBeNull();
  });

  it('does not query the npm registry for a remote runtime', async () => {
    await getRuntimeSnapshot('claude', { connectionId: 'ssh-1' });

    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('reports the latest npm version for a runtime without a native update cache', async () => {
    mocks.getDependencyManager.mockResolvedValue({
      get: vi.fn(() => ({
        id: 'claude',
        category: 'agent',
        status: 'available',
        version: '2.1.169',
        path: '/usr/local/bin/claude',
        checkedAt: 1,
      })),
      probe: vi.fn(),
    });
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ latest: '2.1.232', next: '2.1.240' }),
    });

    const snapshot = await getRuntimeSnapshot('claude');

    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://registry.npmjs.org/-/package/%40anthropic-ai%2Fclaude-code/dist-tags',
      expect.anything()
    );
    expect(snapshot.update.latestVersion).toBe('2.1.232');
    expect(snapshot.update.available).toBe(true);
  });
});
