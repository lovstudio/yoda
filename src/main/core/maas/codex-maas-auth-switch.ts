import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { isValidMaasEnvKey, type MaasPlatformId } from '@shared/maas';
import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import {
  CODEX_SHARED_PROVIDER_ID,
  resolveCodexMaasProviderSpec,
  type CodexMaasProviderSpec,
} from './codex-maas-provider';
import {
  codexMaasUserEnvironment,
  LEGACY_CODEX_MAAS_API_KEY_ENV,
  type CodexMaasEnvironmentPublisher,
  type EnvironmentVariableSnapshot,
} from './codex-maas-user-environment';
import { resolveCodexMaasModelId, resolveCodexNativeModelId } from './runtime-env';

const SNAPSHOT_VERSION = 5;
const LEGACY_SNAPSHOT_VERSIONS = new Set([1, 2, 3, 4]);
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
  syncedEnvironment?: {
    name: string;
    snapshot: EnvironmentVariableSnapshot;
  };
};

type SecretStore = Pick<
  typeof encryptedAppSecretsStore,
  'getSecret' | 'setSecret' | 'deleteSecret'
>;

export type CodexMaasAuthRollback = () => Promise<void>;

export type CodexMaasNativeSyncStatus = {
  managed: boolean;
  configManaged: boolean;
  environmentPublished: boolean;
  persistentCredentialStored: boolean;
  envKey: string | null;
};

export class CodexMaasAuthSwitch {
  constructor(
    private readonly secretStore: SecretStore = encryptedAppSecretsStore,
    private readonly userEnvironment: CodexMaasEnvironmentPublisher = codexMaasUserEnvironment
  ) {}

  async getStatus({ codexHome }: { codexHome: string }): Promise<CodexMaasNativeSyncStatus> {
    const paths = resolveCodexPaths(codexHome);
    const storedSnapshot = await this.loadSnapshot(
      snapshotSecretKey(paths.codexHome),
      paths.codexHome
    );
    if (!storedSnapshot) {
      return {
        managed: false,
        configManaged: false,
        environmentPublished: false,
        persistentCredentialStored: false,
        envKey: null,
      };
    }

    const current = await readNativeFiles(paths);
    const syncedEnvironment = storedSnapshot.snapshot.syncedEnvironment;
    const environmentPublished = syncedEnvironment
      ? (await this.userEnvironment.read(syncedEnvironment.name)).exists
      : false;
    const persistentCredentialStored = syncedEnvironment
      ? await this.userEnvironment.isManaged(syncedEnvironment.name)
      : false;
    return {
      managed: true,
      configManaged: current.config.exists && current.config.content.includes(YODA_CONFIG_MARKER),
      environmentPublished,
      persistentCredentialStored,
      envKey: syncedEnvironment?.name ?? null,
    };
  }

  async enable({
    codexHome,
    platformId,
    displayName,
    endpoint,
    envKey,
    apiKey,
    loginItemEnabled = true,
  }: {
    codexHome: string;
    platformId: MaasPlatformId;
    displayName?: string;
    endpoint: string;
    envKey: string;
    apiKey: string;
    loginItemEnabled?: boolean;
  }): Promise<CodexMaasAuthRollback> {
    const baseUrl = normalizeEndpoint(endpoint);
    validateEnvKey(envKey);
    if (!apiKey) throw new Error('A non-empty MaaS API key is required.');
    const paths = resolveCodexPaths(codexHome);
    const before = await readNativeFiles(paths);
    const secretKey = snapshotSecretKey(paths.codexHome);
    const storedSnapshot = await this.loadSnapshot(secretKey, paths.codexHome);
    const originalSnapshot: CodexNativeFilesSnapshot = storedSnapshot?.snapshot ?? before;
    const snapshotCreated = !storedSnapshot;
    const snapshotMigrated = storedSnapshot?.migrated ?? false;
    const previousEnvironment = originalSnapshot.syncedEnvironment;
    const environmentNames = new Set(
      [previousEnvironment?.name, envKey].filter((value): value is string => Boolean(value))
    );
    const environmentBefore = new Map<string, EnvironmentVariableSnapshot>();
    for (const name of environmentNames) {
      environmentBefore.set(name, await this.userEnvironment.read(name));
    }
    const managedBefore = new Map<string, EnvironmentVariableSnapshot>();
    if (previousEnvironment) {
      managedBefore.set(
        previousEnvironment.name,
        await this.userEnvironment.readManaged(previousEnvironment.name)
      );
    }
    const syncedEnvironment =
      previousEnvironment?.name === envKey
        ? previousEnvironment
        : { name: envKey, snapshot: environmentBefore.get(envKey) ?? { exists: false } };
    const snapshotToStore: CodexNativeFilesSnapshot = {
      ...originalSnapshot,
      version: SNAPSHOT_VERSION,
      syncedEnvironment,
    };
    const snapshotChanged =
      snapshotCreated || snapshotMigrated || previousEnvironment?.name !== envKey;

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
        content: buildActiveMaasConfig(
          before.config.exists ? before.config.content : '',
          provider,
          platformId,
          baseUrl,
          envKey
        ),
        mode: 0o600,
      },
      // v2 used this file for command-auth. Current profiles keep the upstream
      // credential in Yoda's encrypted store and inject it only into Codex.
      token: originalSnapshot.token,
    };

    if (snapshotChanged) {
      await this.secretStore.setSecret(secretKey, JSON.stringify(snapshotToStore));
    }

    try {
      if (previousEnvironment && previousEnvironment.name !== envKey) {
        await this.userEnvironment.clearManaged(
          previousEnvironment.name,
          previousEnvironment.snapshot
        );
      }
      await this.userEnvironment.publishManaged(envKey, apiKey, loginItemEnabled);
      await applyNativeFiles(paths, active);
    } catch (error) {
      await applyNativeFiles(paths, before).catch(() => undefined);
      await restoreManagedEnvironment(
        this.userEnvironment,
        environmentNames,
        environmentBefore,
        managedBefore
      ).catch(() => undefined);
      if (snapshotCreated) {
        await this.secretStore.deleteSecret(secretKey).catch(() => undefined);
      } else if (snapshotChanged && storedSnapshot) {
        await this.secretStore
          .setSecret(secretKey, storedSnapshot.serialized)
          .catch(() => undefined);
      }
      throw error;
    }

    return async () => {
      await applyNativeFiles(paths, before);
      await restoreManagedEnvironment(
        this.userEnvironment,
        environmentNames,
        environmentBefore,
        managedBefore
      );
      if (snapshotCreated) {
        await this.secretStore.deleteSecret(secretKey);
      } else if (snapshotChanged && storedSnapshot) {
        await this.secretStore.setSecret(secretKey, storedSnapshot.serialized);
      }
    };
  }

  async enableOfficial({ codexHome }: { codexHome: string }): Promise<CodexMaasAuthRollback> {
    const paths = resolveCodexPaths(codexHome);
    const before = await readNativeFiles(paths);
    const secretKey = snapshotSecretKey(paths.codexHome);
    const storedSnapshot = await this.loadSnapshot(secretKey, paths.codexHome);
    const originalSnapshot: CodexNativeFilesSnapshot = storedSnapshot?.snapshot ?? before;
    const previousEnvironment = originalSnapshot.syncedEnvironment;
    const environmentBefore = previousEnvironment
      ? await this.userEnvironment.read(previousEnvironment.name)
      : undefined;
    const managedBefore = previousEnvironment
      ? await this.userEnvironment.readManaged(previousEnvironment.name)
      : undefined;
    const restoredConfig = before.config.exists
      ? restoreManagedMaasConfig(
          before.config.content,
          originalSnapshot.config.exists ? originalSnapshot.config.content : ''
        )
      : originalSnapshot.config.exists
        ? originalSnapshot.config.content
        : '';
    const snapshotToStore: CodexNativeFilesSnapshot = {
      ...originalSnapshot,
      version: SNAPSHOT_VERSION,
      syncedEnvironment: undefined,
    };
    const active: CodexNativeFilesSnapshot = {
      ...snapshotToStore,
      config: {
        exists: true,
        content: buildActiveOfficialConfig(restoredConfig),
        mode: 0o600,
      },
    };

    await this.secretStore.setSecret(secretKey, JSON.stringify(snapshotToStore));
    try {
      if (previousEnvironment) {
        await this.userEnvironment.clearManaged(
          previousEnvironment.name,
          previousEnvironment.snapshot
        );
      }
      await applyNativeFiles(paths, active);
    } catch (error) {
      await applyNativeFiles(paths, before).catch(() => undefined);
      if (previousEnvironment && environmentBefore) {
        if (managedBefore?.exists) {
          await this.userEnvironment
            .publishManaged(previousEnvironment.name, managedBefore.value)
            .catch(() => undefined);
        } else {
          await this.userEnvironment
            .restore(previousEnvironment.name, environmentBefore)
            .catch(() => undefined);
        }
      }
      if (storedSnapshot) {
        await this.secretStore
          .setSecret(secretKey, storedSnapshot.serialized)
          .catch(() => undefined);
      } else {
        await this.secretStore.deleteSecret(secretKey).catch(() => undefined);
      }
      throw error;
    }

    return async () => {
      await applyNativeFiles(paths, before);
      if (previousEnvironment && environmentBefore) {
        if (managedBefore?.exists) {
          await this.userEnvironment.publishManaged(previousEnvironment.name, managedBefore.value);
        } else {
          await this.userEnvironment.restore(previousEnvironment.name, environmentBefore);
        }
      }
      if (storedSnapshot) {
        await this.secretStore.setSecret(secretKey, storedSnapshot.serialized);
      } else {
        await this.secretStore.deleteSecret(secretKey);
      }
    };
  }

  async disable({ codexHome }: { codexHome: string }): Promise<CodexMaasAuthRollback> {
    const paths = resolveCodexPaths(codexHome);
    const secretKey = snapshotSecretKey(paths.codexHome);
    const before = await readNativeFiles(paths);
    const storedSnapshot = await this.loadSnapshot(secretKey, paths.codexHome);
    if (!storedSnapshot) return async () => undefined;
    const syncedEnvironment = storedSnapshot.snapshot.syncedEnvironment;
    const environmentBefore = syncedEnvironment
      ? await this.userEnvironment.read(syncedEnvironment.name)
      : undefined;
    const managedBefore = syncedEnvironment
      ? await this.userEnvironment.readManaged(syncedEnvironment.name)
      : undefined;

    try {
      if (syncedEnvironment) {
        await this.userEnvironment.clearManaged(syncedEnvironment.name, syncedEnvironment.snapshot);
      }
      const originalConfig = storedSnapshot.snapshot.config;
      const restored: CodexNativeFilesSnapshot = {
        ...storedSnapshot.snapshot,
        config: before.config.exists
          ? {
              exists: true,
              content: restoreManagedMaasConfig(
                before.config.content,
                originalConfig.exists ? originalConfig.content : ''
              ),
              mode: originalConfig.exists ? originalConfig.mode : 0o600,
            }
          : originalConfig,
      };
      await applyNativeFiles(paths, restored);
      await this.secretStore.deleteSecret(secretKey);
    } catch (error) {
      await applyNativeFiles(paths, before).catch(() => undefined);
      if (environmentBefore) {
        if (managedBefore?.exists) {
          await this.userEnvironment
            .publishManaged(syncedEnvironment!.name, managedBefore.value)
            .catch(() => undefined);
        } else {
          await this.userEnvironment
            .restore(syncedEnvironment!.name, environmentBefore)
            .catch(() => undefined);
        }
      }
      throw error;
    }

    return async () => {
      await this.secretStore.setSecret(secretKey, storedSnapshot.serialized);
      await applyNativeFiles(paths, before);
      if (environmentBefore) {
        if (managedBefore?.exists) {
          await this.userEnvironment.publishManaged(syncedEnvironment!.name, managedBefore.value);
        } else {
          await this.userEnvironment.restore(syncedEnvironment!.name, environmentBefore);
        }
      }
    };
  }

  private async loadSnapshot(
    secretKey: string,
    codexHome: string
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
    const parsed = parseSnapshot(serialized);
    const snapshot = parsed.snapshot;
    if (snapshot.codexHome !== codexHome) {
      throw new Error('Stored Codex MaaS snapshot belongs to a different CODEX_HOME.');
    }
    return {
      serialized,
      snapshot,
      migrated: parsed.migrated,
    };
  }
}

async function restoreManagedEnvironment(
  publisher: CodexMaasEnvironmentPublisher,
  names: Set<string>,
  environmentBefore: Map<string, EnvironmentVariableSnapshot>,
  managedBefore: Map<string, EnvironmentVariableSnapshot>
): Promise<void> {
  for (const name of names) {
    await publisher.clearManaged(name, environmentBefore.get(name) ?? { exists: false });
  }
  for (const [name, snapshot] of managedBefore) {
    if (snapshot.exists) await publisher.publishManaged(name, snapshot.value);
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
}): Promise<CodexNativeFilesSnapshot> {
  const [auth, config, token] = await Promise.all([
    readFileSnapshot(paths.authPath),
    readFileSnapshot(paths.configPath),
    readFileSnapshot(paths.tokenPath),
  ]);
  return { version: SNAPSHOT_VERSION, codexHome: paths.codexHome, auth, config, token };
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
  paths: { authPath: string; configPath: string; tokenPath: string },
  snapshot: CodexNativeFilesSnapshot
): Promise<void> {
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

function buildRegisteredMaasConfig(
  content: string,
  provider: CodexMaasProviderSpec,
  endpoint: string,
  envKey: string
): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  let lines = content.replace(/\r\n/g, '\n').split('\n');
  lines = removeTable(lines, modelProviderTablePattern(provider.providerId));
  lines = trimTrailingBlankLines(lines);
  lines.push(
    '',
    YODA_CONFIG_MARKER,
    `[model_providers.${provider.providerId}]`,
    `name = ${formatTomlString(provider.name)}`,
    `base_url = ${formatTomlString(endpoint.replace(/\/+$/, ''))}`,
    'wire_api = "responses"',
    `env_key = ${formatTomlString(envKey)}`
  );

  const result = `${trimTrailingBlankLines(lines).join('\n')}\n`.replace(/\n/g, eol);
  validateRegisteredMaasConfig(result, provider, envKey);
  return result;
}

function buildActiveMaasConfig(
  content: string,
  provider: CodexMaasProviderSpec,
  platformId: MaasPlatformId,
  endpoint: string,
  envKey: string
): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const currentModel = readRootString(content, 'model');
  const mappedModel = currentModel
    ? resolveCodexMaasModelId(
        { platformId, endpoint, apiKey: '' },
        resolveCodexNativeModelId(currentModel)
      )
    : undefined;
  let lines = buildRegisteredMaasConfig(content, provider, endpoint, envKey)
    .replace(/\r\n/g, '\n')
    .split('\n');
  lines = removeRootAssignments(lines, ['model_provider', 'openai_base_url', 'model']);
  lines = trimLeadingBlankLines(lines);
  lines = trimTrailingBlankLines(lines);
  lines.unshift(
    YODA_CONFIG_MARKER,
    `model_provider = ${formatTomlString(provider.providerId)}`,
    ...(mappedModel ? [`model = ${formatTomlString(mappedModel)}`] : []),
    ''
  );
  const result = `${trimTrailingBlankLines(lines).join('\n')}\n`.replace(/\n/g, eol);
  validateActiveMaasConfig(result, provider, envKey);
  return result;
}

function buildActiveOfficialConfig(content: string): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const currentModel = readRootString(content, 'model');
  let lines = content.replace(/\r\n/g, '\n').split('\n');
  lines = removeTable(lines, modelProviderTablePattern(CODEX_SHARED_PROVIDER_ID));
  lines = removeRootAssignments(lines, ['model_provider', 'openai_base_url', 'model']);
  lines = trimLeadingBlankLines(lines);
  lines = trimTrailingBlankLines(lines);
  lines.unshift(
    YODA_CONFIG_MARKER,
    `model_provider = ${formatTomlString(CODEX_SHARED_PROVIDER_ID)}`,
    ...(currentModel
      ? [`model = ${formatTomlString(resolveCodexNativeModelId(currentModel))}`]
      : []),
    ''
  );
  lines = trimTrailingBlankLines(lines);
  lines.push(
    '',
    YODA_CONFIG_MARKER,
    `[model_providers.${CODEX_SHARED_PROVIDER_ID}]`,
    'name = "OpenAI"',
    'requires_openai_auth = true',
    'supports_websockets = true',
    'wire_api = "responses"'
  );
  return `${trimTrailingBlankLines(lines).join('\n')}\n`.replace(/\n/g, eol);
}

function restoreRootProviderSelection(content: string, originalContent: string): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const currentModel = readRootString(content, 'model');
  let lines = content.replace(/\r\n/g, '\n').split('\n');
  lines = removeRootAssignments(lines, ['model_provider', 'openai_base_url', 'model']);
  lines = trimLeadingBlankLines(lines);
  lines = trimTrailingBlankLines(lines);
  const originalAssignments = extractRootAssignments(originalContent, [
    'model_provider',
    'openai_base_url',
  ]);
  const restoredAssignments = [
    ...originalAssignments,
    ...(currentModel
      ? [`model = ${formatTomlString(resolveCodexNativeModelId(currentModel))}`]
      : []),
  ];
  if (restoredAssignments.length > 0) lines.unshift(...restoredAssignments, '');
  return `${trimTrailingBlankLines(lines).join('\n')}\n`.replace(/\n/g, eol);
}

function readRootString(content: string, key: string): string | undefined {
  const parsed = parseToml(content) as Record<string, unknown>;
  const value = parsed[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function restoreManagedMaasConfig(content: string, originalContent: string): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const managedProviderIds = findManagedProviderIds(content);
  let lines = content.replace(/\r\n/g, '\n').split('\n');

  for (const providerId of managedProviderIds) {
    lines = removeTable(lines, modelProviderTablePattern(providerId));
    const originalTable = extractTable(
      originalContent.replace(/\r\n/g, '\n').split('\n'),
      modelProviderTablePattern(providerId)
    );
    if (originalTable.length > 0) {
      lines = trimTrailingBlankLines(lines);
      lines.push('', ...originalTable);
    }
  }

  return restoreRootProviderSelection(
    `${trimTrailingBlankLines(lines).join('\n')}\n`.replace(/\n/g, eol),
    originalContent
  );
}

function findManagedProviderIds(content: string): string[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const ids = new Set<string>();
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (lines[index]?.trim() !== YODA_CONFIG_MARKER) continue;
    const providerId = parseModelProviderTableId(lines[index + 1] ?? '');
    if (providerId) ids.add(providerId);
  }
  return [...ids];
}

function parseModelProviderTableId(line: string): string | undefined {
  const match = line.match(
    /^\s*\[\s*model_providers\s*\.\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*\]\s*(?:#.*)?$/
  );
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function extractTable(lines: string[], tablePattern: RegExp): string[] {
  const result: string[] = [];
  let collecting = false;
  for (const line of lines) {
    if (/^\s*\[/.test(line)) {
      const isTargetTable = tablePattern.test(line);
      if (!collecting && isTargetTable) collecting = true;
      else if (collecting && !isTargetTable) break;
    }
    if (collecting) result.push(line);
  }
  return trimTrailingBlankLines(result);
}

function extractRootAssignments(content: string, keys: string[]): string[] {
  const keyPattern = keys.map(escapeRegExp).join('|');
  const assignmentPattern = new RegExp(`^\\s*(?:${keyPattern})\\s*=`);
  const result: string[] = [];
  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*\[/.test(line)) break;
    if (assignmentPattern.test(line)) result.push(line);
  }
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
      const isTargetTable = tablePattern.test(line);
      if (isTargetTable) {
        while (result.at(-1)?.trim() === '') result.pop();
        if (result.at(-1)?.trim() === YODA_CONFIG_MARKER) result.pop();
        skipping = true;
        continue;
      }
      skipping = false;
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

function validateRegisteredMaasConfig(
  content: string,
  provider: CodexMaasProviderSpec,
  envKey: string
): void {
  const parsed = parseToml(content) as Record<string, unknown>;
  const modelProviders = asRecord(parsed.model_providers);
  const providerConfig = asRecord(modelProviders?.[provider.providerId]);
  if (
    providerConfig?.name !== provider.name ||
    provider.name === 'OpenAI' ||
    typeof providerConfig?.base_url !== 'string' ||
    providerConfig?.wire_api !== 'responses' ||
    providerConfig?.requires_openai_auth !== undefined ||
    providerConfig?.env_key !== envKey ||
    providerConfig?.experimental_bearer_token !== undefined ||
    providerConfig?.auth !== undefined
  ) {
    throw new Error('Generated Codex MaaS provider config is invalid.');
  }
}

function validateActiveMaasConfig(
  content: string,
  provider: CodexMaasProviderSpec,
  envKey: string
): void {
  validateRegisteredMaasConfig(content, provider, envKey);
  const parsed = parseToml(content) as Record<string, unknown>;
  if (parsed.model_provider !== provider.providerId) {
    throw new Error('Generated Codex MaaS provider config is invalid.');
  }
}

function validateEnvKey(envKey: string): void {
  if (!isValidMaasEnvKey(envKey)) {
    throw new Error('Invalid MaaS environment variable name.');
  }
}

function normalizeEndpoint(endpoint: string): string {
  const baseUrl = endpoint.trim().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('A non-empty MaaS endpoint is required.');
  return baseUrl;
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

function trimLeadingBlankLines(lines: string[]): string[] {
  const result = [...lines];
  while (result[0]?.trim() === '') result.shift();
  return result;
}

function formatTomlString(value: string): string {
  return JSON.stringify(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseSnapshot(serialized: string): {
  snapshot: CodexNativeFilesSnapshot;
  migrated: boolean;
} {
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
    const legacyEnvironment =
      record.version === 3 && isEnvironmentVariableSnapshot(record.environment)
        ? record.environment
        : undefined;
    return {
      snapshot: {
        version: SNAPSHOT_VERSION,
        codexHome: record.codexHome,
        auth: record.auth,
        config: record.config,
        token:
          record.version >= 2 && isFileSnapshot(record.token) ? record.token : { exists: false },
        ...(legacyEnvironment
          ? {
              syncedEnvironment: {
                name: LEGACY_CODEX_MAAS_API_KEY_ENV,
                snapshot: legacyEnvironment,
              },
            }
          : {}),
      },
      migrated: true,
    };
  }
  if (
    record.version !== SNAPSHOT_VERSION ||
    !isFileSnapshot(record.token) ||
    (record.syncedEnvironment !== undefined &&
      !isSyncedEnvironmentSnapshot(record.syncedEnvironment))
  ) {
    throw new Error('Invalid Codex MaaS snapshot.');
  }
  return { snapshot: record as CodexNativeFilesSnapshot, migrated: false };
}

function isSyncedEnvironmentSnapshot(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === 'string' && isEnvironmentVariableSnapshot(record.snapshot);
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
