import { readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RuntimeCustomConfig } from '@shared/app-settings';
import { expandRuntimeHome, resolveRuntimePaths } from '@shared/runtime-paths';
import { getUpdateCommandForRuntime, type RuntimeId } from '@shared/runtime-registry';
import type { RuntimeSnapshot } from '@shared/runtime-snapshot';
import { getDependencyManager } from '@main/core/dependencies/dependency-manager';
import { log } from '@main/lib/logger';
import { getRuntimeLatestVersion } from './runtime-latest-version';
import { runtimeOverrideSettings } from './runtime-settings-service';
import {
  isNewerVersion,
  parseCodexVersionCache,
  parseRuntimeConfigText,
  type ParsedRuntimeConfig,
  type RuntimeVersionInfo,
} from './runtime-snapshot-parser';

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function localConfigPath(runtimeId: RuntimeId): string | null {
  if (runtimeId === 'codex' && process.env.CODEX_HOME?.trim()) {
    return path.join(process.env.CODEX_HOME.trim(), 'config.toml');
  }
  const paths = resolveRuntimePaths(runtimeId);
  const candidate = paths.settings ?? paths.config;
  return candidate ? expandRuntimeHome(candidate, os.homedir()) : null;
}

function codexHome(): string {
  return process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex');
}

async function loadNativeConfig(
  runtimeId: RuntimeId,
  connectionId?: string
): Promise<{ path: string | null; exists: boolean | null; parsed: ParsedRuntimeConfig }> {
  // Native config inspection currently runs only on the local machine. Do not
  // resolve or return a local path for a remote runtime: besides being
  // irrelevant to that host, it would expose misleading local filesystem data
  // in the remote runtime card.
  if (connectionId) {
    return {
      path: null,
      exists: null,
      parsed: { model: null, provider: null },
    };
  }
  const configPath = localConfigPath(runtimeId);
  if (!configPath) {
    return {
      path: configPath,
      exists: false,
      parsed: { model: null, provider: null },
    };
  }
  const exists = await pathExists(configPath);
  if (!exists) return { path: configPath, exists, parsed: { model: null, provider: null } };
  try {
    const input = await readFile(configPath, 'utf8');
    return { path: configPath, exists, parsed: parseRuntimeConfigText(configPath, input) };
  } catch (error) {
    log.debug('runtime snapshot: failed to read native config', {
      runtimeId,
      configPath,
      error: String(error),
    });
    return { path: configPath, exists, parsed: { model: null, provider: null } };
  }
}

async function loadUpdateInfo(
  runtimeId: RuntimeId,
  connectionId?: string
): Promise<RuntimeVersionInfo> {
  // Remote runtimes are inspected through their own host; the local Codex
  // cache and this machine's registry lookups say nothing about them.
  if (connectionId) return { latestVersion: null, lastCheckedAt: null };

  if (runtimeId === 'codex') {
    const cached = await readFile(path.join(codexHome(), 'version.json'), 'utf8')
      .then(parseCodexVersionCache)
      .catch(() => null);
    // The Codex cache only exists after its own update check ran. Fall through
    // to the npm registry so the card is never empty.
    if (cached?.latestVersion) return cached;
  }

  return (await getRuntimeLatestVersion(runtimeId)) ?? { latestVersion: null, lastCheckedAt: null };
}

function snapshotConfig(config: RuntimeCustomConfig | undefined): RuntimeSnapshot['config'] {
  return {
    disabled: config?.disabled === true,
    path: null,
    exists: null,
    cli: config?.cli?.trim() || null,
    defaultArgs: config?.defaultArgs ?? [],
    extraArgs: config?.extraArgs?.trim() || null,
    authProvider: config?.authProvider ?? null,
    envKeys: Object.keys(config?.env ?? {}).sort(),
  };
}

export async function getRuntimeSnapshot(
  runtimeId: RuntimeId,
  options: { connectionId?: string; forceRefresh?: boolean } = {}
): Promise<RuntimeSnapshot> {
  const manager = await getDependencyManager(options.connectionId);
  let installation = manager.get(runtimeId) ?? null;
  if (options.forceRefresh || !installation) {
    installation = await manager.probe(runtimeId).catch(() => installation);
  }

  const [providerConfig, nativeConfig, updateInfo] = await Promise.all([
    runtimeOverrideSettings.getItem(runtimeId),
    loadNativeConfig(runtimeId, options.connectionId),
    loadUpdateInfo(runtimeId, options.connectionId),
  ]);
  const config = snapshotConfig(providerConfig);
  config.path = nativeConfig.path;
  config.exists = nativeConfig.exists;
  const currentVersion = installation?.version ?? null;
  const available =
    currentVersion && updateInfo.latestVersion
      ? isNewerVersion(updateInfo.latestVersion, currentVersion)
      : null;

  return {
    runtimeId,
    installation,
    update: {
      command: getUpdateCommandForRuntime(runtimeId),
      latestVersion: updateInfo.latestVersion,
      lastCheckedAt: updateInfo.lastCheckedAt,
      available,
    },
    model: {
      defaultModel: providerConfig?.defaultModel?.trim() || null,
      nativeModel: nativeConfig.parsed.model,
      provider: nativeConfig.parsed.provider,
    },
    config,
    checkedAt: Date.now(),
  };
}

export function runtimeSupportsUpdate(runtimeId: RuntimeId): boolean {
  return Boolean(getUpdateCommandForRuntime(runtimeId));
}
