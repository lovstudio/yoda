import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type { MaasPlatformId } from '@shared/maas';
import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { resolveCodexMaasProviderSpec, type CodexMaasProviderSpec } from './codex-maas-provider';
import {
  CODEX_MAAS_API_KEY_ENV,
  codexMaasUserEnvironment,
  type CodexMaasEnvironmentPublisher,
  type EnvironmentVariableSnapshot,
} from './codex-maas-user-environment';

const SNAPSHOT_VERSION = 3;
const LEGACY_SNAPSHOT_VERSIONS = new Set([1, 2]);
const SECRET_PREFIX = 'yoda-maas-codex-native-files';
const YODA_CONFIG_MARKER = '# Auto-injected by Yoda MaaS';
const YODA_PROVIDER_TOKEN_FILENAME = '.yoda-maas-provider-token';

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
  token: FileSnapshot;
  environment: EnvironmentVariableSnapshot;
};

type SecretStore = Pick<
  typeof encryptedAppSecretsStore,
  'getSecret' | 'setSecret' | 'deleteSecret'
>;

export type CodexMaasAuthRollback = () => Promise<void>;

export class CodexMaasAuthSwitch {
  constructor(
    private readonly secretStore: SecretStore = encryptedAppSecretsStore,
    private readonly userEnvironment: CodexMaasEnvironmentPublisher = codexMaasUserEnvironment
  ) {}

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
    const token = apiKey.trim();
    if (!token) throw new Error('A non-empty MaaS API key is required.');
    const paths = resolveCodexPaths(codexHome);
    const before = await readNativeState(paths, this.userEnvironment);
    const secretKey = snapshotSecretKey(paths.codexHome);
    const storedSnapshot = await this.loadSnapshot(secretKey, paths.codexHome, before.environment);
    const originalSnapshot = storedSnapshot?.snapshot ?? before;
    const snapshotCreated = !storedSnapshot;
    const snapshotMigrated = storedSnapshot?.migrated ?? false;

    const baseConfig = originalSnapshot.config;
    const provider = resolveCodexMaasProviderSpec(platformId, displayName);
    const active: CodexNativeFilesSnapshot = {
      version: SNAPSHOT_VERSION,
      codexHome: paths.codexHome,
      // A custom provider has its own authentication. Keep the user's OpenAI /
      // ChatGPT account intact instead of rewriting auth.json into OpenAI API-key
      // mode, which makes Codex App misidentify the active provider.
      auth: originalSnapshot.auth,
      config: {
        exists: true,
        content: buildMaasConfig(baseConfig.exists ? baseConfig.content : '', provider, endpoint),
        mode: 0o600,
      },
      // v2 used this file for command-auth. Restore the pre-Yoda state while
      // env_key reads the credential from the GUI login-session environment.
      token: originalSnapshot.token,
      environment: { exists: true, value: token },
    };

    if (snapshotCreated || snapshotMigrated) {
      await this.secretStore.setSecret(secretKey, JSON.stringify(originalSnapshot));
    }

    try {
      await applyNativeState(paths, active, this.userEnvironment);
    } catch (error) {
      await applyNativeState(paths, before, this.userEnvironment).catch(() => undefined);
      if (snapshotCreated) {
        await this.secretStore.deleteSecret(secretKey).catch(() => undefined);
      } else if (snapshotMigrated && storedSnapshot) {
        await this.secretStore
          .setSecret(secretKey, storedSnapshot.serialized)
          .catch(() => undefined);
      }
      throw error;
    }

    return async () => {
      await applyNativeState(paths, before, this.userEnvironment);
      if (snapshotCreated) {
        await this.secretStore.deleteSecret(secretKey);
      } else if (snapshotMigrated && storedSnapshot) {
        await this.secretStore.setSecret(secretKey, storedSnapshot.serialized);
      }
    };
  }

  async disable({ codexHome }: { codexHome: string }): Promise<CodexMaasAuthRollback> {
    const paths = resolveCodexPaths(codexHome);
    const secretKey = snapshotSecretKey(paths.codexHome);
    const before = await readNativeState(paths, this.userEnvironment);
    const storedSnapshot = await this.loadSnapshot(secretKey, paths.codexHome, before.environment);
    if (!storedSnapshot) return async () => undefined;

    try {
      await applyNativeState(paths, storedSnapshot.snapshot, this.userEnvironment);
      await this.secretStore.deleteSecret(secretKey);
    } catch (error) {
      await applyNativeState(paths, before, this.userEnvironment).catch(() => undefined);
      throw error;
    }

    return async () => {
      await this.secretStore.setSecret(secretKey, storedSnapshot.serialized);
      await applyNativeState(paths, before, this.userEnvironment);
    };
  }

  private async loadSnapshot(
    secretKey: string,
    codexHome: string,
    legacyEnvironment: EnvironmentVariableSnapshot
  ): Promise<
    | {
        serialized: string;
        snapshot: CodexNativeFilesSnapshot;
        migrated: boolean;
      }
    | undefined
  > {
    const serialized = await this.secretStore.getSecret(secretKey);
    if (!serialized) return undefined;
    const parsed = parseSnapshot(serialized, legacyEnvironment);
    const snapshot = parsed.snapshot;
    if (snapshot.codexHome !== codexHome) {
      throw new Error('Stored Codex MaaS snapshot belongs to a different CODEX_HOME.');
    }
    return { serialized, snapshot, migrated: parsed.migrated };
  }
}

function resolveCodexPaths(codexHome: string): {
  codexHome: string;
  authPath: string;
  configPath: string;
  tokenPath: string;
} {
  const resolvedHome = resolve(codexHome);
  return {
    codexHome: resolvedHome,
    authPath: join(resolvedHome, 'auth.json'),
    configPath: join(resolvedHome, 'config.toml'),
    tokenPath: join(resolvedHome, YODA_PROVIDER_TOKEN_FILENAME),
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
  tokenPath: string;
}): Promise<Omit<CodexNativeFilesSnapshot, 'environment'>> {
  const [auth, config, token] = await Promise.all([
    readFileSnapshot(paths.authPath),
    readFileSnapshot(paths.configPath),
    readFileSnapshot(paths.tokenPath),
  ]);
  return { version: SNAPSHOT_VERSION, codexHome: paths.codexHome, auth, config, token };
}

async function readNativeState(
  paths: {
    codexHome: string;
    authPath: string;
    configPath: string;
    tokenPath: string;
  },
  userEnvironment: CodexMaasEnvironmentPublisher
): Promise<CodexNativeFilesSnapshot> {
  const [files, environment] = await Promise.all([readNativeFiles(paths), userEnvironment.read()]);
  return { ...files, environment };
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

async function applyNativeState(
  paths: { authPath: string; configPath: string; tokenPath: string },
  snapshot: CodexNativeFilesSnapshot,
  userEnvironment: CodexMaasEnvironmentPublisher
): Promise<void> {
  // Publish credentials before the config that references them. Finder/Dock
  // apps launched after this point inherit the value from the user session.
  await userEnvironment.restore(snapshot.environment);
  await applyFileSnapshot(paths.tokenPath, snapshot.token);
  // MaaS providers own their authentication. Never rewrite auth.json: Codex
  // may have refreshed or replaced the user's OpenAI login while MaaS was on.
  await applyFileSnapshot(paths.configPath, snapshot.config);
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
  lines = removeRootAssignments(lines, ['model_provider', 'openai_base_url']);
  lines = removeTable(lines, modelProviderTablePattern(provider.providerId));
  lines = trimTrailingBlankLines(lines);

  lines.unshift(
    YODA_CONFIG_MARKER,
    `model_provider = ${formatTomlString(provider.providerId)}`,
    ''
  );
  lines.push(
    '',
    YODA_CONFIG_MARKER,
    `[model_providers.${provider.providerId}]`,
    `name = ${formatTomlString(provider.name)}`,
    `base_url = ${formatTomlString(endpoint.replace(/\/+$/, ''))}`,
    'wire_api = "responses"',
    `env_key = ${formatTomlString(CODEX_MAAS_API_KEY_ENV)}`
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
    `^\\s*\\[\\s*model_providers\\s*\\.\\s*(?:${escaped}|"${escaped}"|'${escaped}')(?:\\s*\\.[^\\]]+)?\\s*\\]\\s*(?:#.*)?$`
  );
}

function validateMaasConfig(content: string, provider: CodexMaasProviderSpec): void {
  const parsed = parseToml(content) as Record<string, unknown>;
  const modelProviders = asRecord(parsed.model_providers);
  const providerConfig = asRecord(modelProviders?.[provider.providerId]);
  if (
    parsed.model_provider !== provider.providerId ||
    providerConfig?.name !== provider.name ||
    provider.name === 'OpenAI' ||
    typeof providerConfig?.base_url !== 'string' ||
    providerConfig?.wire_api !== 'responses' ||
    providerConfig?.requires_openai_auth !== undefined ||
    providerConfig?.env_key !== CODEX_MAAS_API_KEY_ENV ||
    providerConfig?.experimental_bearer_token !== undefined ||
    providerConfig?.auth !== undefined
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

function parseSnapshot(
  serialized: string,
  legacyEnvironment: EnvironmentVariableSnapshot
): { snapshot: CodexNativeFilesSnapshot; migrated: boolean } {
  const parsed = JSON.parse(serialized) as unknown;
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid Codex MaaS snapshot.');
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.codexHome !== 'string' ||
    !isFileSnapshot(record.auth) ||
    !isFileSnapshot(record.config)
  ) {
    throw new Error('Invalid Codex MaaS snapshot.');
  }
  if (typeof record.version === 'number' && LEGACY_SNAPSHOT_VERSIONS.has(record.version)) {
    return {
      snapshot: {
        version: SNAPSHOT_VERSION,
        codexHome: record.codexHome,
        auth: record.auth,
        config: record.config,
        token:
          record.version === 2 && isFileSnapshot(record.token) ? record.token : { exists: false },
        environment: legacyEnvironment,
      },
      migrated: true,
    };
  }
  if (
    record.version !== SNAPSHOT_VERSION ||
    !isFileSnapshot(record.token) ||
    !isEnvironmentVariableSnapshot(record.environment)
  ) {
    throw new Error('Invalid Codex MaaS snapshot.');
  }
  return { snapshot: record as CodexNativeFilesSnapshot, migrated: false };
}

function isFileSnapshot(value: unknown): value is FileSnapshot {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.exists === false) return true;
  return (
    record.exists === true && typeof record.content === 'string' && typeof record.mode === 'number'
  );
}

function isEnvironmentVariableSnapshot(value: unknown): value is EnvironmentVariableSnapshot {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.exists === false) return true;
  return record.exists === true && typeof record.value === 'string';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export const codexMaasAuthSwitch = new CodexMaasAuthSwitch();
