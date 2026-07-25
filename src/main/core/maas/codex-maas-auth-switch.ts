import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type { MaasPlatformId } from '@shared/maas';
import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { resolveCodexMaasProviderSpec, type CodexMaasProviderSpec } from './codex-maas-provider';

const SNAPSHOT_VERSION = 2;
const LEGACY_SNAPSHOT_VERSION = 1;
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
    const token = apiKey.trim();
    if (!token) throw new Error('A non-empty MaaS API key is required.');
    const paths = resolveCodexPaths(codexHome);
    const before = await readNativeFiles(paths);
    const secretKey = snapshotSecretKey(paths.codexHome);
    const storedSnapshot = await this.loadSnapshot(secretKey, paths.codexHome);
    const originalSnapshot = storedSnapshot?.snapshot ?? before;
    const snapshotCreated = !storedSnapshot;

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
        content: buildMaasConfig(
          baseConfig.exists ? baseConfig.content : '',
          provider,
          endpoint,
          paths.tokenPath
        ),
        mode: 0o600,
      },
      token: {
        exists: true,
        content: `${token}\n`,
        mode: 0o600,
      },
    };

    if (snapshotCreated) {
      await this.secretStore.setSecret(secretKey, JSON.stringify(originalSnapshot));
    }

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
  // Publish credentials before the config that references them. This keeps a
  // concurrently running Codex App from observing a half-applied provider.
  await applyFileSnapshot(paths.tokenPath, snapshot.token);
  await applyFileSnapshot(paths.authPath, snapshot.auth);
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
  endpoint: string,
  tokenPath: string
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
  const authCommand = resolveProviderAuthCommand(tokenPath);
  lines.push(
    '',
    YODA_CONFIG_MARKER,
    `[model_providers.${provider.providerId}]`,
    `name = ${formatTomlString(provider.name)}`,
    `base_url = ${formatTomlString(endpoint.replace(/\/+$/, ''))}`,
    'wire_api = "responses"',
    '',
    YODA_CONFIG_MARKER,
    `[model_providers.${provider.providerId}.auth]`,
    `command = ${formatTomlString(authCommand.command)}`,
    `args = ${formatTomlStringArray(authCommand.args)}`,
    'timeout_ms = 5000',
    'refresh_interval_ms = 0'
  );

  const result = `${trimTrailingBlankLines(lines).join('\n')}\n`.replace(/\n/g, eol);
  validateMaasConfig(result, provider, authCommand);
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

function validateMaasConfig(
  content: string,
  provider: CodexMaasProviderSpec,
  authCommand: { command: string; args: string[] }
): void {
  const parsed = parseToml(content) as Record<string, unknown>;
  const modelProviders = asRecord(parsed.model_providers);
  const providerConfig = asRecord(modelProviders?.[provider.providerId]);
  const providerAuth = asRecord(providerConfig?.auth);
  if (
    parsed.model_provider !== provider.providerId ||
    providerConfig?.name !== provider.name ||
    provider.name === 'OpenAI' ||
    typeof providerConfig?.base_url !== 'string' ||
    providerConfig?.wire_api !== 'responses' ||
    providerConfig?.requires_openai_auth !== undefined ||
    providerConfig?.env_key !== undefined ||
    providerConfig?.experimental_bearer_token !== undefined ||
    providerAuth?.command !== authCommand.command ||
    !stringArraysEqual(providerAuth?.args, authCommand.args) ||
    providerAuth?.timeout_ms !== 5000 ||
    providerAuth?.refresh_interval_ms !== 0
  ) {
    throw new Error('Generated Codex MaaS provider config is invalid.');
  }
}

function resolveProviderAuthCommand(tokenPath: string): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '[Console]::Out.Write((Get-Content -Raw -LiteralPath $args[0]).Trim())',
        tokenPath,
      ],
    };
  }
  return { command: '/bin/cat', args: [tokenPath] };
}

function stringArraysEqual(value: unknown, expected: string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  );
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

function formatTomlStringArray(values: string[]): string {
  return `[${values.map(formatTomlString).join(', ')}]`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseSnapshot(serialized: string): CodexNativeFilesSnapshot {
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
  if (record.version === LEGACY_SNAPSHOT_VERSION) {
    return {
      version: SNAPSHOT_VERSION,
      codexHome: record.codexHome,
      auth: record.auth,
      config: record.config,
      token: { exists: false },
    };
  }
  if (record.version !== SNAPSHOT_VERSION || !isFileSnapshot(record.token)) {
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
