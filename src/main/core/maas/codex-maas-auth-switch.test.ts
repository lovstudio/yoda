import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexMaasAuthSwitch } from './codex-maas-auth-switch';
import type {
  CodexMaasEnvironmentPublisher,
  EnvironmentVariableSnapshot,
} from './codex-maas-user-environment';

vi.mock('@main/core/secrets/encrypted-app-secrets-store', () => ({
  encryptedAppSecretsStore: {
    getSecret: vi.fn(async () => null),
    setSecret: vi.fn(async () => undefined),
    deleteSecret: vi.fn(async () => undefined),
  },
}));

const temporaryHomes = new Set<string>();
const GATEWAY_BASE_URL = 'http://127.0.0.1:15721/v1';

class MemorySecretStore {
  readonly secrets = new Map<string, string>();

  async getSecret(key: string): Promise<string | null> {
    return this.secrets.get(key) ?? null;
  }

  async setSecret(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
  }

  async deleteSecret(key: string): Promise<void> {
    this.secrets.delete(key);
  }
}

class MemoryUserEnvironment implements CodexMaasEnvironmentPublisher {
  current: EnvironmentVariableSnapshot = { exists: false };

  async read(): Promise<EnvironmentVariableSnapshot> {
    return structuredClone(this.current);
  }

  async publish(value: string): Promise<void> {
    this.current = { exists: true, value };
  }

  async restore(snapshot: EnvironmentVariableSnapshot): Promise<void> {
    this.current = structuredClone(snapshot);
  }
}

afterEach(async () => {
  await Promise.all([...temporaryHomes].map((path) => rm(path, { recursive: true, force: true })));
  temporaryHomes.clear();
});

describe('Codex MaaS native authentication switch', () => {
  let codexHome: string;
  let authPath: string;
  let configPath: string;
  let tokenPath: string;
  let secrets: MemorySecretStore;
  let userEnvironment: MemoryUserEnvironment;
  let authSwitch: CodexMaasAuthSwitch;
  const originalAuth = `${JSON.stringify(
    {
      auth_mode: 'chatgpt',
      tokens: { access_token: 'access', refresh_token: 'refresh', id_token: 'id' },
      last_refresh: '2026-07-25T00:00:00.000Z',
    },
    null,
    2
  )}\n`;
  const originalConfig = 'model = "gpt-5"\r\n\r\n[features]\r\nfast_mode = true\r\n';

  beforeEach(async () => {
    codexHome = await mkdtemp(join(tmpdir(), 'yoda-codex-maas-auth-'));
    temporaryHomes.add(codexHome);
    authPath = join(codexHome, 'auth.json');
    configPath = join(codexHome, 'config.toml');
    tokenPath = join(codexHome, '.yoda-maas-provider-token');
    await writeFile(authPath, originalAuth, { mode: 0o600 });
    await writeFile(configPath, originalConfig, { mode: 0o640 });
    secrets = new MemorySecretStore();
    userEnvironment = new MemoryUserEnvironment();
    authSwitch = new CodexMaasAuthSwitch(secrets, userEnvironment);
  });

  it('points Codex at the local Gateway without replacing the OpenAI account', async () => {
    await enableGateway(authSwitch, codexHome, {
      platformId: 'zenmux',
      displayName: 'OpenAI',
      gatewayToken: 'local-admission-token',
    });

    expect(await readFile(authPath, 'utf8')).toBe(originalAuth);
    await expect(readFile(tokenPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(userEnvironment.current).toEqual({ exists: false });
    const activeConfig = await readFile(configPath, 'utf8');
    expect(activeConfig).toContain('# Auto-injected by Yoda MaaS\r\n');
    expect(activeConfig).toContain('model_provider = "zenmux"\r\n');
    expect(activeConfig).toContain('[model_providers.zenmux]\r\n');
    expect(activeConfig).toContain('name = "ZenMux"\r\n');
    expect(activeConfig).toContain(`base_url = "${GATEWAY_BASE_URL}"\r\n`);
    expect(activeConfig).toContain('wire_api = "responses"\r\n');
    expect(activeConfig).toContain('experimental_bearer_token = "local-admission-token"\r\n');
    expect(activeConfig).not.toContain('env_key = ');
    expect(activeConfig).not.toContain('[model_providers.zenmux.auth]\r\n');
    expect(activeConfig).not.toContain('command = ');
    expect(activeConfig).not.toContain('requires_openai_auth');
    expect(activeConfig).not.toContain('upstream-secret');
    expect(activeConfig).toContain('[features]\r\nfast_mode = true\r\n');
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    expect(secrets.secrets.size).toBe(1);

    await authSwitch.disable({ codexHome });

    expect(await readFile(authPath, 'utf8')).toBe(originalAuth);
    expect(await readFile(configPath, 'utf8')).toBe(originalConfig);
    expect((await stat(authPath)).mode & 0o777).toBe(0o600);
    expect((await stat(configPath)).mode & 0o777).toBe(0o640);
    expect(secrets.secrets.size).toBe(0);
  });

  it('updates the active platform without replacing the first snapshot', async () => {
    await enableGateway(authSwitch, codexHome, {
      platformId: 'zenmux',
      gatewayToken: 'first-local-token',
    });
    await enableGateway(authSwitch, codexHome, {
      platformId: 'openrouter',
      displayName: 'OpenRouter',
      gatewayToken: 'second-local-token',
    });

    const activeConfig = await readFile(configPath, 'utf8');
    expect(activeConfig).toContain('model_provider = "openrouter"');
    expect(activeConfig).toContain('[model_providers.openrouter]');
    expect(activeConfig).toContain(`base_url = "${GATEWAY_BASE_URL}"`);
    expect(activeConfig).toContain('experimental_bearer_token = "second-local-token"');
    expect(activeConfig).not.toContain('first-local-token');
    expect(userEnvironment.current).toEqual({ exists: false });

    await authSwitch.disable({ codexHome });
    expect(await readFile(configPath, 'utf8')).toBe(originalConfig);
  });

  it('writes LiteLLM as a distinct Codex model provider', async () => {
    await enableGateway(authSwitch, codexHome, {
      platformId: 'litellm',
      displayName: 'LiteLLM',
    });

    const activeConfig = await readFile(configPath, 'utf8');
    expect(activeConfig).toContain('model_provider = "litellm"');
    expect(activeConfig).toContain('[model_providers.litellm]');
    expect(activeConfig).toContain('name = "LiteLLM"');
    expect(activeConfig).toContain('wire_api = "responses"');
  });

  it('rolls an enable operation back without leaving a stale snapshot', async () => {
    const rollback = await enableGateway(authSwitch, codexHome);

    await rollback();

    expect(await readFile(authPath, 'utf8')).toBe(originalAuth);
    expect(await readFile(configPath, 'utf8')).toBe(originalConfig);
    expect(userEnvironment.current).toEqual({ exists: false });
    expect(secrets.secrets.size).toBe(0);
  });

  it('rejects an empty Gateway token without creating a snapshot', async () => {
    await expect(enableGateway(authSwitch, codexHome, { gatewayToken: '   ' })).rejects.toThrow(
      'non-empty MaaS Gateway token'
    );

    expect(await readFile(configPath, 'utf8')).toBe(originalConfig);
    expect(secrets.secrets.size).toBe(0);
  });

  it('can roll a disable operation back when the surrounding settings update fails', async () => {
    await enableGateway(authSwitch, codexHome);
    const activeConfig = await readFile(configPath, 'utf8');
    const rollback = await authSwitch.disable({ codexHome });

    await rollback();

    expect(await readFile(configPath, 'utf8')).toBe(activeConfig);
    expect(secrets.secrets.size).toBe(1);
  });

  it('replaces an existing provider table without rewriting the user shell policy', async () => {
    const configWithExistingProvider = [
      'model_provider = "zenmux"',
      '',
      '[model_providers.zenmux]',
      'name = "Old ZenMux"',
      'base_url = "https://old.example.test/v1"',
      'env_key = "ZENMUX_API_KEY"',
      '',
      '[model_providers.zenmux.auth]',
      'command = "/usr/bin/old-helper"',
      '',
      '[shell_environment_policy.set]',
      'KEEP_ME = "yes"',
      'ZENMUX_API_KEY = "old-secret"',
      '',
      '[features]',
      'fast_mode = true',
      '',
    ].join('\n');
    await writeFile(configPath, configWithExistingProvider, { mode: 0o640 });

    await enableGateway(authSwitch, codexHome, { gatewayToken: 'local-token' });

    const activeConfig = await readFile(configPath, 'utf8');
    expect(activeConfig.match(/\[model_providers\.zenmux\]/g)).toHaveLength(1);
    expect(activeConfig.match(/\[model_providers\.zenmux\.auth\]/g) ?? []).toHaveLength(0);
    expect(activeConfig.match(/^ZENMUX_API_KEY\s*=/gm)).toHaveLength(1);
    expect(activeConfig).toContain(`base_url = "${GATEWAY_BASE_URL}"`);
    expect(activeConfig).not.toContain('env_key = "ZENMUX_API_KEY"');
    expect(activeConfig).not.toContain('/usr/bin/old-helper');
    expect(activeConfig).toContain('KEEP_ME = "yes"');
    expect(activeConfig).toContain('ZENMUX_API_KEY = "old-secret"');

    await authSwitch.disable({ codexHome });
    expect(await readFile(configPath, 'utf8')).toBe(configWithExistingProvider);
  });

  it('preserves the OpenAI credential-store preference and refreshed login', async () => {
    const keyringConfig = [
      'model = "gpt-5"',
      'cli_auth_credentials_store = "keyring"',
      '',
      '[features]',
      'fast_mode = true',
      '',
    ].join('\n');
    await writeFile(configPath, keyringConfig, { mode: 0o640 });

    await enableGateway(authSwitch, codexHome);
    const refreshedAuth = `${JSON.stringify({ auth_mode: 'chatgpt', refreshed: true })}\n`;
    await writeFile(authPath, refreshedAuth, { mode: 0o600 });
    const activeConfig = await readFile(configPath, 'utf8');
    expect(activeConfig.match(/^cli_auth_credentials_store\s*=/gm)).toHaveLength(1);
    expect(activeConfig).toContain('cli_auth_credentials_store = "keyring"');

    await authSwitch.disable({ codexHome });
    expect(await readFile(authPath, 'utf8')).toBe(refreshedAuth);
    expect(await readFile(configPath, 'utf8')).toBe(keyringConfig);
  });

  it('does not modify a user-owned session variable in proxy mode', async () => {
    userEnvironment.current = { exists: true, value: 'user-owned-secret' };

    await enableGateway(authSwitch, codexHome);
    expect(userEnvironment.current).toEqual({ exists: true, value: 'user-owned-secret' });
    userEnvironment.current = { exists: true, value: 'changed-while-maas-is-active' };

    await authSwitch.disable({ codexHome });
    expect(userEnvironment.current).toEqual({
      exists: true,
      value: 'changed-while-maas-is-active',
    });
  });

  it('migrates a v3 snapshot and clears the previously published upstream key', async () => {
    userEnvironment.current = { exists: true, value: 'user-owned-secret' };
    await enableGateway(authSwitch, codexHome, { gatewayToken: 'first-local-token' });
    const snapshotEntry = [...secrets.secrets.entries()][0];
    if (!snapshotEntry) throw new Error('Expected a stored native-files snapshot.');
    const [snapshotKey, serialized] = snapshotEntry;
    const legacySnapshot = JSON.parse(serialized) as Record<string, unknown>;
    legacySnapshot.version = 3;
    legacySnapshot.environment = { exists: true, value: 'user-owned-secret' };
    secrets.secrets.set(snapshotKey, JSON.stringify(legacySnapshot));
    userEnvironment.current = { exists: true, value: 'legacy-upstream-secret' };
    await writeFile(tokenPath, 'legacy-command-auth-token\n', { mode: 0o600 });

    await enableGateway(authSwitch, codexHome, { gatewayToken: 'second-local-token' });

    expect(userEnvironment.current).toEqual({ exists: true, value: 'user-owned-secret' });
    await expect(readFile(tokenPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    const activeConfig = await readFile(configPath, 'utf8');
    expect(activeConfig).toContain('experimental_bearer_token = "second-local-token"');
    expect(activeConfig).not.toContain('legacy-upstream-secret');

    await authSwitch.disable({ codexHome });
    expect(await readFile(configPath, 'utf8')).toBe(originalConfig);
    expect(userEnvironment.current).toEqual({ exists: true, value: 'user-owned-secret' });
  });
});

function enableGateway(
  authSwitch: CodexMaasAuthSwitch,
  codexHome: string,
  overrides: {
    platformId?: 'zenmux' | 'openrouter' | 'litellm';
    displayName?: string;
    gatewayToken?: string;
  } = {}
) {
  return authSwitch.enable({
    codexHome,
    platformId: overrides.platformId ?? 'zenmux',
    displayName: overrides.displayName,
    gatewayBaseUrl: GATEWAY_BASE_URL,
    gatewayToken: overrides.gatewayToken ?? 'local-admission-token',
  });
}
