import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type { MaasPlatformId } from '@shared/maas';
import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { resolveCodexMaasProviderSpec, type CodexMaasProviderSpec } from './codex-maas-provider';

const SNAPSHOT_VERSION = 1;
const SECRET_PREFIX = 'yoda-maas-codex-native-files';
const YODA_CONFIG_MARKER = '# Auto-injected by Yoda MaaS';

type FileSnapshot =
  | { exists: false }
  | {
      exists: true;
      content: string;
      mode: number;
    };

type CodexNativeFilesSnapshot = {
  version: typeof SNAPSHOT_VERSION;
  codexHome: string;
  auth: FileSnapshot;
  config: FileSnapshot;
};

type SecretStore = Pick<
  typeof encryptedAppSecretsStore,
  'getSecret' | 'setSecret' | 'deleteSecret'
>;

export type CodexMaasAuthRollback = () => Promise<void>;

export class CodexMaasAuthSwitch {
  constructor(private readonly secretStore: SecretStore = encryptedAppSecretsStore) {}

  async enable({
    codexHome,
    platformId,
    displayName,
    endpoint,
    apiKey,
  }: {
    codexHome: string;
    platformId: MaasPlatformId;
    displayName?: string;
    endpoint: string;
    apiKey: string;
  }): Promise<CodexMaasAuthRollback> {
    const paths = resolveCodexPaths(codexHome);
    const before = await readNativeFiles(paths);
    const secretKey = snapshotSecretKey(paths.codexHome);
    const storedSnapshot = await this.loadSnapshot(secretKey, paths.codexHome);
    const originalSnapshot = storedSnapshot?.snapshot ?? before;
    const snapshotCreated = !storedSnapshot;

    if (snapshotCreated) {
      await this.secretStore.setSecret(secretKey, JSON.stringify(originalSnapshot));
    }

    const baseConfig = originalSnapshot.config;
    const provider = resolveCodexMaasProviderSpec(platformId, displayName);
    const active: CodexNativeFilesSnapshot = {
      version: SNAPSHOT_VERSION,
      codexHome: paths.codexHome,
      auth: {
        exists: true,
        content: `${JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: apiKey }, null, 2)}\n`,
        mode: 0o600,
      },
      config: {
        exists: true,
        content: buildMaasConfig(baseConfig.exists ? baseConfig.content : '', provider, endpoint),
        mode: 0o600,
      },
    };

    try {
      await applyNativeFiles(paths, active);
    } catch (error) {
      await applyNativeFiles(paths, before).catch(() => undefined);
      if (snapshotCreated) await this.secretStore.deleteSecret(secretKey).catch(() => undefined);
      throw error;
    }

    return async () => {
      await applyNativeFiles(paths, before);
      if (snapshotCreated) await this.secretStore.deleteSecret(secretKey);
    };
  }

  async disable({ codexHome }: { codexHome: string }): Promise<CodexMaasAuthRollback> {
    const paths = resolveCodexPaths(codexHome);
    const secretKey = snapshotSecretKey(paths.codexHome);
    const storedSnapshot = await this.loadSnapshot(secretKey, paths.codexHome);
    if (!storedSnapshot) return async () => undefined;

    const before = await readNativeFiles(paths);
    try {
      await applyNativeFiles(paths, storedSnapshot.snapshot);
      await this.secretStore.deleteSecret(secretKey);
    } catch (error) {
      await applyNativeFiles(paths, before).catch(() => undefined);
      throw error;
    }

    return async () => {
      await this.secretStore.setSecret(secretKey, storedSnapshot.serialized);
      await applyNativeFiles(paths, before);
    };
  }

  private async loadSnapshot(
    secretKey: string,
    codexHome: string
  ): Promise<{ serialized: string; snapshot: CodexNativeFilesSnapshot } | undefined> {
    const serialized = await this.secretStore.getSecret(secretKey);
    if (!serialized) return undefined;
    const snapshot = parseSnapshot(serialized);
    if (snapshot.codexHome !== codexHome) {
      throw new Error('Stored Codex MaaS snapshot belongs to a different CODEX_HOME.');
    }
    return { serialized, snapshot };
  }
}

function resolveCodexPaths(codexHome: string): {
  codexHome: string;
  authPath: string;
  configPath: string;
} {
  const resolvedHome = resolve(codexHome);
  return {
    codexHome: resolvedHome,
    authPath: join(resolvedHome, 'auth.json'),
    configPath: join(resolvedHome, 'config.toml'),
  };
}

function snapshotSecretKey(codexHome: string): string {
  const homeHash = createHash('sha256').update(codexHome).digest('hex');
  return `${SECRET_PREFIX}:${homeHash}`;
}

async function readNativeFiles(paths: {
  codexHome: string;
  authPath: string;
  configPath: string;
}): Promise<CodexNativeFilesSnapshot> {
  const [auth, config] = await Promise.all([
    readFileSnapshot(paths.authPath),
    readFileSnapshot(paths.configPath),
  ]);
  return { version: SNAPSHOT_VERSION, codexHome: paths.codexHome, auth, config };
}

async function readFileSnapshot(path: string): Promise<FileSnapshot> {
  try {
    const [content, metadata] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    return { exists: true, content, mode: metadata.mode & 0o777 };
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return { exists: false };
    throw error;
  }
}

async function applyNativeFiles(
  paths: { authPath: string; configPath: string },
  snapshot: CodexNativeFilesSnapshot
): Promise<void> {
  await applyFileSnapshot(paths.configPath, snapshot.config);
  await applyFileSnapshot(paths.authPath, snapshot.auth);
}

async function applyFileSnapshot(path: string, snapshot: FileSnapshot): Promise<void> {
  if (!snapshot.exists) {
    await rm(path, { force: true });
    return;
  }

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.yoda-${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, snapshot.content, {
      encoding: 'utf8',
      flag: 'wx',
      mode: snapshot.mode,
    });
    await rename(temporaryPath, path);
    await chmod(path, snapshot.mode);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function buildMaasConfig(
  content: string,
  provider: CodexMaasProviderSpec,
  endpoint: string
): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  let lines = content.replace(/\r\n/g, '\n').split('\n');
  lines = removeRootAssignments(lines, [
    'model_provider',
    'openai_base_url',
    'cli_auth_credentials_store',
  ]);
  lines = removeTable(lines, modelProviderTablePattern(provider.providerId));
  lines = trimTrailingBlankLines(lines);

  lines.unshift(
    YODA_CONFIG_MARKER,
    `model_provider = ${formatTomlString(provider.providerId)}`,
    'cli_auth_credentials_store = "file"',
    ''
  );
  lines.push(
    '',
    YODA_CONFIG_MARKER,
    `[model_providers.${provider.providerId}]`,
    `name = ${formatTomlString(provider.name)}`,
    `base_url = ${formatTomlString(endpoint.replace(/\/+$/, ''))}`,
    'wire_api = "responses"',
    'requires_openai_auth = true'
  );

  const result = `${trimTrailingBlankLines(lines).join('\n')}\n`.replace(/\n/g, eol);
  validateMaasConfig(result, provider);
  return result;
}

function removeRootAssignments(lines: string[], keys: string[]): string[] {
  const keyPattern = keys.map(escapeRegExp).join('|');
  const assignmentPattern = new RegExp(`^\\s*(?:${keyPattern})\\s*=`);
  let atRoot = true;
  return lines.filter((line) => {
    const trimmed = line.trim();
    if (atRoot && /^\[/.test(trimmed)) atRoot = false;
    if (!atRoot) return true;
    if (trimmed === YODA_CONFIG_MARKER) return false;
    return !assignmentPattern.test(line);
  });
}

function removeTable(lines: string[], tablePattern: RegExp): string[] {
  const result: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (/^\s*\[/.test(line)) {
      skipping = tablePattern.test(line);
    }
    if (!skipping) result.push(line);
  }
  return result;
}

function modelProviderTablePattern(providerId: string): RegExp {
  const escaped = escapeRegExp(providerId);
  return new RegExp(
    `^\\s*\\[\\s*model_providers\\s*\\.\\s*(?:${escaped}|"${escaped}"|'${escaped}')\\s*\\]\\s*(?:#.*)?$`
  );
}

function validateMaasConfig(content: string, provider: CodexMaasProviderSpec): void {
  const parsed = parseToml(content) as Record<string, unknown>;
  const modelProviders = asRecord(parsed.model_providers);
  const providerConfig = asRecord(modelProviders?.[provider.providerId]);
  if (
    parsed.model_provider !== provider.providerId ||
    parsed.cli_auth_credentials_store !== 'file' ||
    providerConfig?.name !== provider.name ||
    typeof providerConfig?.base_url !== 'string' ||
    providerConfig?.wire_api !== 'responses' ||
    providerConfig?.requires_openai_auth !== true ||
    providerConfig?.env_key !== undefined
  ) {
    throw new Error('Generated Codex MaaS provider config is invalid.');
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const result = [...lines];
  while (result.at(-1)?.trim() === '') result.pop();
  return result;
}

function formatTomlString(value: string): string {
  return JSON.stringify(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseSnapshot(serialized: string): CodexNativeFilesSnapshot {
  const parsed = JSON.parse(serialized) as unknown;
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid Codex MaaS snapshot.');
  const record = parsed as Record<string, unknown>;
  if (
    record.version !== SNAPSHOT_VERSION ||
    typeof record.codexHome !== 'string' ||
    !isFileSnapshot(record.auth) ||
    !isFileSnapshot(record.config)
  ) {
    throw new Error('Invalid Codex MaaS snapshot.');
  }
  return record as CodexNativeFilesSnapshot;
}

function isFileSnapshot(value: unknown): value is FileSnapshot {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.exists === false) return true;
  return (
    record.exists === true && typeof record.content === 'string' && typeof record.mode === 'number'
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export const codexMaasAuthSwitch = new CodexMaasAuthSwitch();
