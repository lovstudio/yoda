import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';
import type { MaasPlatformId } from '@shared/maas';
import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { resolveMaasRuntimeEnv } from './runtime-env';

const SNAPSHOT_VERSION = 1;
const SECRET_PREFIX = 'yoda-maas-claude-settings';
const SETTINGS_FILENAME = 'settings.json';
const MANAGED_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_ATTRIBUTION_HEADER',
  'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
] as const;

type ManagedEnvKey = (typeof MANAGED_ENV_KEYS)[number];

type ValueSnapshot = { exists: false } | { exists: true; value: unknown };

type FileSnapshot =
  | { exists: false }
  | {
      exists: true;
      content: string;
      mode: number;
    };

type ClaudeSettingsSnapshot = {
  version: typeof SNAPSHOT_VERSION;
  claudeHome: string;
  settingsExisted: boolean;
  settingsMode: number;
  originalEnv: Record<ManagedEnvKey, ValueSnapshot>;
  activeEnv: Record<string, string>;
};

type SecretStore = Pick<
  typeof encryptedAppSecretsStore,
  'getSecret' | 'setSecret' | 'deleteSecret'
>;

export type ClaudeMaasSettingsRollback = () => Promise<void>;

export type ClaudeMaasSettingsStatus = {
  managed: boolean;
  configManaged: boolean;
  persistentCredentialStored: boolean;
};

export class ClaudeMaasSettingsSwitch {
  constructor(private readonly secretStore: SecretStore = encryptedAppSecretsStore) {}

  async getStatus({ claudeHome }: { claudeHome: string }): Promise<ClaudeMaasSettingsStatus> {
    const resolvedHome = resolve(claudeHome);
    const stored = await this.loadSnapshot(resolvedHome);
    if (!stored) {
      return { managed: false, configManaged: false, persistentCredentialStored: false };
    }

    const current = await readFileSnapshot(settingsPath(resolvedHome));
    if (!current.exists) {
      return { managed: true, configManaged: false, persistentCredentialStored: false };
    }
    const settings = parseSettings(current.content);
    const env = isPlainObject(settings.env) ? settings.env : {};
    const configManaged = Object.entries(stored.snapshot.activeEnv).every(
      ([key, value]) => env[key] === value
    );
    return {
      managed: true,
      configManaged,
      persistentCredentialStored:
        configManaged &&
        typeof env.ANTHROPIC_AUTH_TOKEN === 'string' &&
        env.ANTHROPIC_AUTH_TOKEN.length > 0,
    };
  }

  async enable({
    claudeHome,
    platformId,
    displayName,
    endpoint,
    apiKey,
  }: {
    claudeHome: string;
    platformId: MaasPlatformId;
    displayName?: string;
    endpoint: string;
    apiKey: string;
  }): Promise<ClaudeMaasSettingsRollback> {
    if (!apiKey.trim()) throw new Error('A non-empty MaaS API key is required.');
    const activeEnv = resolveMaasRuntimeEnv('claude', {
      platformId,
      displayName,
      endpoint,
      apiKey,
    });
    if (!activeEnv) {
      throw new Error('The active MaaS Profile is not compatible with Claude Code.');
    }

    const resolvedHome = resolve(claudeHome);
    const configPath = settingsPath(resolvedHome);
    const before = await readFileSnapshot(configPath);
    const secretKey = snapshotSecretKey(resolvedHome);
    const stored = await this.loadSnapshot(resolvedHome);
    const originalSnapshot =
      stored?.snapshot ?? createSnapshot(resolvedHome, before, parseSettings(fileContent(before)));
    const nextSnapshot: ClaudeSettingsSnapshot = { ...originalSnapshot, activeEnv };
    const nextContent = writeManagedEnv(fileContent(before), activeEnv);

    await this.secretStore.setSecret(secretKey, JSON.stringify(nextSnapshot));
    try {
      await writeSettingsAtomic(configPath, nextContent, 0o600);
    } catch (error) {
      await applyFileSnapshot(configPath, before).catch(() => undefined);
      if (stored) {
        await this.secretStore.setSecret(secretKey, stored.serialized).catch(() => undefined);
      } else {
        await this.secretStore.deleteSecret(secretKey).catch(() => undefined);
      }
      throw error;
    }

    return async () => {
      await applyFileSnapshot(configPath, before);
      if (stored) await this.secretStore.setSecret(secretKey, stored.serialized);
      else await this.secretStore.deleteSecret(secretKey);
    };
  }

  async disable({ claudeHome }: { claudeHome: string }): Promise<ClaudeMaasSettingsRollback> {
    const resolvedHome = resolve(claudeHome);
    const configPath = settingsPath(resolvedHome);
    const secretKey = snapshotSecretKey(resolvedHome);
    const stored = await this.loadSnapshot(resolvedHome);
    if (!stored) return async () => undefined;

    const before = await readFileSnapshot(configPath);
    const restoredContent = restoreManagedEnv(fileContent(before), stored.snapshot.originalEnv);
    try {
      const restoredSettings = parseSettings(restoredContent);
      if (!stored.snapshot.settingsExisted && Object.keys(restoredSettings).length === 0) {
        await rm(configPath, { force: true });
      } else {
        await writeSettingsAtomic(configPath, restoredContent, stored.snapshot.settingsMode);
      }
      await this.secretStore.deleteSecret(secretKey);
    } catch (error) {
      await applyFileSnapshot(configPath, before).catch(() => undefined);
      throw error;
    }

    return async () => {
      await this.secretStore.setSecret(secretKey, stored.serialized);
      await applyFileSnapshot(configPath, before);
    };
  }

  private async loadSnapshot(
    claudeHome: string
  ): Promise<{ snapshot: ClaudeSettingsSnapshot; serialized: string } | undefined> {
    const serialized = await this.secretStore.getSecret(snapshotSecretKey(claudeHome));
    if (!serialized) return undefined;
    const snapshot = parseSnapshot(serialized);
    if (snapshot.claudeHome !== claudeHome) {
      throw new Error('Stored Claude Code MaaS snapshot belongs to a different CLAUDE_CONFIG_DIR.');
    }
    return { snapshot, serialized };
  }
}

export const claudeMaasSettingsSwitch = new ClaudeMaasSettingsSwitch();

function settingsPath(claudeHome: string): string {
  return join(claudeHome, SETTINGS_FILENAME);
}

function snapshotSecretKey(claudeHome: string): string {
  return `${SECRET_PREFIX}:${createHash('sha256').update(claudeHome).digest('hex')}`;
}

function createSnapshot(
  claudeHome: string,
  file: FileSnapshot,
  settings: Record<string, unknown>
): ClaudeSettingsSnapshot {
  const env = isPlainObject(settings.env) ? settings.env : {};
  return {
    version: SNAPSHOT_VERSION,
    claudeHome,
    settingsExisted: file.exists,
    settingsMode: file.exists ? file.mode : 0o600,
    originalEnv: Object.fromEntries(
      MANAGED_ENV_KEYS.map((key) => [
        key,
        Object.prototype.hasOwnProperty.call(env, key)
          ? { exists: true, value: env[key] }
          : { exists: false },
      ])
    ) as Record<ManagedEnvKey, ValueSnapshot>,
    activeEnv: {},
  };
}

function writeManagedEnv(raw: string, activeEnv: Record<string, string>): string {
  let next = removeManagedEnv(raw);
  for (const [key, value] of Object.entries(activeEnv))
    next = editSetting(next, ['env', key], value);
  return ensureTrailingNewline(next);
}

function restoreManagedEnv(raw: string, originalEnv: Record<ManagedEnvKey, ValueSnapshot>): string {
  let next = removeManagedEnv(raw);
  for (const key of MANAGED_ENV_KEYS) {
    const snapshot = originalEnv[key];
    if (snapshot.exists) next = editSetting(next, ['env', key], snapshot.value);
  }
  const settings = parseSettings(next);
  if (isPlainObject(settings.env) && Object.keys(settings.env).length === 0) {
    next = editSetting(next, ['env'], undefined);
  }
  return ensureTrailingNewline(next);
}

function removeManagedEnv(raw: string): string {
  let next = raw;
  for (const key of MANAGED_ENV_KEYS) {
    const settings = parseSettings(next);
    const env = isPlainObject(settings.env) ? settings.env : {};
    if (Object.prototype.hasOwnProperty.call(env, key)) {
      next = editSetting(next, ['env', key], undefined);
    }
  }
  return next;
}

function editSetting(raw: string, path: (string | number)[], value: unknown): string {
  return applyEdits(
    raw,
    modify(raw, path, value, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: detectEol(raw) },
    })
  );
}

function fileContent(snapshot: FileSnapshot): string {
  return snapshot.exists ? snapshot.content : '{}\n';
}

function parseSettings(raw: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const parsed = parse(raw, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0 || !isPlainObject(parsed)) {
    throw new Error('Claude Code settings.json must be a valid JSON/JSONC object.');
  }
  return parsed;
}

function parseSnapshot(serialized: string): ClaudeSettingsSnapshot {
  const parsed = JSON.parse(serialized) as unknown;
  if (!isPlainObject(parsed)) throw new Error('Invalid Claude Code MaaS snapshot.');
  if (
    parsed.version !== SNAPSHOT_VERSION ||
    typeof parsed.claudeHome !== 'string' ||
    typeof parsed.settingsExisted !== 'boolean' ||
    typeof parsed.settingsMode !== 'number' ||
    !isPlainObject(parsed.originalEnv) ||
    !isStringRecord(parsed.activeEnv)
  ) {
    throw new Error('Invalid Claude Code MaaS snapshot.');
  }
  for (const key of MANAGED_ENV_KEYS) {
    if (!isValueSnapshot(parsed.originalEnv[key])) {
      throw new Error('Invalid Claude Code MaaS snapshot.');
    }
  }
  return parsed as ClaudeSettingsSnapshot;
}

async function readFileSnapshot(path: string): Promise<FileSnapshot> {
  try {
    const [content, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    return { exists: true, content, mode: info.mode & 0o777 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false };
    throw error;
  }
}

async function writeSettingsAtomic(path: string, content: string, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: 'utf8', mode });
    await chmod(temporaryPath, mode);
    await rename(temporaryPath, path);
    await chmod(path, mode);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function applyFileSnapshot(path: string, snapshot: FileSnapshot): Promise<void> {
  if (!snapshot.exists) {
    await rm(path, { force: true });
    return;
  }
  await writeSettingsAtomic(path, snapshot.content, snapshot.mode);
}

function detectEol(raw: string): string {
  return raw.includes('\r\n') ? '\r\n' : '\n';
}

function ensureTrailingNewline(raw: string): string {
  if (raw.endsWith('\r\n') || raw.endsWith('\n')) return raw;
  return `${raw}${detectEol(raw)}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isPlainObject(value) && Object.values(value).every((item) => typeof item === 'string');
}

function isValueSnapshot(value: unknown): value is ValueSnapshot {
  if (!isPlainObject(value)) return false;
  if (value.exists === false) return true;
  return value.exists === true && Object.prototype.hasOwnProperty.call(value, 'value');
}
