import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeMaasSettingsSwitch } from './claude-maas-settings-switch';

vi.mock('@main/core/secrets/encrypted-app-secrets-store', () => ({
  encryptedAppSecretsStore: {
    getSecret: vi.fn(),
    setSecret: vi.fn(),
    deleteSecret: vi.fn(),
  },
}));

class MemorySecretStore {
  readonly values = new Map<string, string>();

  async getSecret(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setSecret(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async deleteSecret(key: string): Promise<void> {
    this.values.delete(key);
  }
}

const temporaryHomes = new Set<string>();

afterEach(async () => {
  await Promise.all([...temporaryHomes].map((path) => rm(path, { recursive: true, force: true })));
  temporaryHomes.clear();
});

describe('Claude Code MaaS settings switch', () => {
  let claudeHome: string;
  let settingsPath: string;
  let secrets: MemorySecretStore;
  let settingsSwitch: ClaudeMaasSettingsSwitch;

  beforeEach(async () => {
    claudeHome = await mkdtemp(join(tmpdir(), 'yoda-claude-maas-'));
    temporaryHomes.add(claudeHome);
    settingsPath = join(claudeHome, 'settings.json');
    secrets = new MemorySecretStore();
    settingsSwitch = new ClaudeMaasSettingsSwitch(secrets);
  });

  it('publishes the supported MaaS route while preserving unrelated JSONC settings', async () => {
    await writeFile(
      settingsPath,
      '{\n  // keep this comment\n  "cleanupPeriodDays": 365,\n  "env": {\n    "KEEP_ME": "1",\n    "ANTHROPIC_BASE_URL": "https://before.example.test"\n  }\n}\n',
      { mode: 0o640 }
    );

    await settingsSwitch.enable({
      claudeHome,
      platformId: 'zenmux',
      displayName: 'ZenMux',
      endpoint: 'https://zenmux.ai/api/v1',
      apiKey: 'secret',
    });

    const active = await readFile(settingsPath, 'utf8');
    expect(active).toContain('// keep this comment');
    expect(active).toContain('"KEEP_ME": "1"');
    expect(active).toContain('"ANTHROPIC_BASE_URL": "https://zenmux.ai/api/anthropic"');
    expect(active).toContain('"ANTHROPIC_AUTH_TOKEN": "secret"');
    expect(active).toContain('"ANTHROPIC_API_KEY": ""');
    expect(active).toContain('"CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS": "1"');
    expect((await stat(settingsPath)).mode & 0o777).toBe(0o600);
    await expect(settingsSwitch.getStatus({ claudeHome })).resolves.toEqual({
      managed: true,
      configManaged: true,
      persistentCredentialStored: true,
    });

    await settingsSwitch.disable({ claudeHome });

    const restored = await readFile(settingsPath, 'utf8');
    expect(restored).toContain('// keep this comment');
    expect(restored).toContain('"KEEP_ME": "1"');
    expect(restored).toContain('"ANTHROPIC_BASE_URL": "https://before.example.test"');
    expect(restored).not.toContain('ANTHROPIC_AUTH_TOKEN');
    expect(restored).not.toContain('CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS');
    expect((await stat(settingsPath)).mode & 0o777).toBe(0o640);
    await expect(settingsSwitch.getStatus({ claudeHome })).resolves.toEqual({
      managed: false,
      configManaged: false,
      persistentCredentialStored: false,
    });
  });

  it('switches adapters without losing the original values used for restore', async () => {
    await writeFile(
      settingsPath,
      JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'before', KEEP_ME: 'yes' } }, null, 2) + '\n'
    );

    await settingsSwitch.enable({
      claudeHome,
      platformId: 'zenmux',
      endpoint: 'https://zenmux.ai/api/v1',
      apiKey: 'zenmux-secret',
    });
    await settingsSwitch.enable({
      claudeHome,
      platformId: 'openrouter',
      endpoint: 'https://openrouter.ai/api/v1',
      apiKey: 'openrouter-secret',
    });

    const switched = JSON.parse(await readFile(settingsPath, 'utf8')) as {
      env: Record<string, string>;
    };
    expect(switched.env).toMatchObject({
      KEEP_ME: 'yes',
      ANTHROPIC_AUTH_TOKEN: 'openrouter-secret',
      ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
    });
    expect(switched.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS).toBeUndefined();

    await settingsSwitch.disable({ claudeHome });
    const restored = JSON.parse(await readFile(settingsPath, 'utf8')) as {
      env: Record<string, string>;
    };
    expect(restored.env).toEqual({ ANTHROPIC_AUTH_TOKEN: 'before', KEEP_ME: 'yes' });
  });

  it('removes a settings file created only for MaaS and supports transactional rollback', async () => {
    const enableRollback = await settingsSwitch.enable({
      claudeHome,
      platformId: 'openrouter',
      endpoint: 'https://openrouter.ai/api/v1',
      apiKey: 'secret',
    });
    await expect(readFile(settingsPath, 'utf8')).resolves.toContain('ANTHROPIC_AUTH_TOKEN');

    await enableRollback();
    await expect(readFile(settingsPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    await settingsSwitch.enable({
      claudeHome,
      platformId: 'openrouter',
      endpoint: 'https://openrouter.ai/api/v1',
      apiKey: 'secret',
    });
    const active = await readFile(settingsPath, 'utf8');
    const disableRollback = await settingsSwitch.disable({ claudeHome });
    await expect(readFile(settingsPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    await disableRollback();
    await expect(readFile(settingsPath, 'utf8')).resolves.toBe(active);
  });

  it('rejects a provider without an Anthropic-compatible surface', async () => {
    await expect(
      settingsSwitch.enable({
        claudeHome,
        platformId: 'siliconflow',
        endpoint: 'https://api.siliconflow.cn/v1',
        apiKey: 'secret',
      })
    ).rejects.toThrow('not compatible with Claude Code');
    expect(secrets.values.size).toBe(0);
    await expect(readFile(settingsPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
