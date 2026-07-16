import { createHash } from 'node:crypto';
import type {
  AppSettings,
  AppSettingsKey,
  MaasSettings,
  RuntimeCustomConfig,
} from '@shared/app-settings';
import { isValidRuntimeId } from '@shared/runtime-registry';
import {
  YODA_SETTINGS_ARCHIVE_KIND,
  YODA_SETTINGS_ARCHIVE_VERSION,
  type YodaSettingsArchive,
} from '@shared/settings-sync';
import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import {
  APP_SETTINGS_SCHEMA_MAP,
  runtimeCustomConfigEntrySchema,
} from '@main/core/settings/schema';
import { appSettingsService } from '@main/core/settings/settings-service';
import { viewStateService } from '@main/core/view-state/view-state-service';

export const PORTABLE_APP_SETTINGS_KEYS = [
  'project',
  'tasks',
  'runtimeAutoApproveDefaults',
  'runtimePermissionModes',
  'automations',
  'kanban',
  'maas',
  'llm',
  'defaultRuntime',
  'keyboard',
  'notifications',
  'theme',
  'systemThemes',
  'openIn',
  'interface',
  'terminal',
  'customThemes',
  'browserPreview',
  'statusline',
  'promptPrinciples',
  'updates',
] as const satisfies readonly AppSettingsKey[];

const PORTABLE_SIDEBAR_KEYS = [
  'taskSortBy',
  'taskGroupBy',
  'taskBranchDisplay',
  'pinnedCollapsed',
  'projectsCollapsed',
  'hideProjectsWithoutActiveTasks',
  'hideTasksWithoutActiveConversations',
  'sortNeedsReviewLast',
  'sortArchivingLast',
  'navSectionHidden',
] as const;

const SENSITIVE_ENV_NAME = /(api[_-]?key|token|secret|password|credential|authorization|cookie)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeMaasSettings(settings: MaasSettings): MaasSettings {
  return {
    ...settings,
    connections: settings.connections.map((connection) => ({
      ...connection,
      keyFingerprint: null,
      inferenceKeyFingerprint: null,
      lastCheckedAt: null,
    })),
  };
}

export function sanitizeRuntimeConfig(config: RuntimeCustomConfig): RuntimeCustomConfig {
  if (!config.env) return config;
  const env = Object.fromEntries(
    Object.entries(config.env).filter(([name]) => !SENSITIVE_ENV_NAME.test(name))
  );
  return { ...config, env };
}

function sensitiveEnvironment(env: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env ?? {}).filter(([name]) => SENSITIVE_ENV_NAME.test(name))
  );
}

function sanitizeSidebar(snapshot: unknown): Record<string, unknown> | undefined {
  if (!isRecord(snapshot)) return undefined;
  const portable: Record<string, unknown> = {};
  for (const key of PORTABLE_SIDEBAR_KEYS) {
    const value = snapshot[key];
    if (key === 'taskSortBy') {
      if (value === 'created-at' || value === 'updated-at') portable[key] = value;
      continue;
    }
    if (key === 'taskGroupBy') {
      if (value === 'project' || value === 'none' || value === 'type' || value === 'activity') {
        portable[key] = value;
      }
      continue;
    }
    if (key === 'taskBranchDisplay') {
      if (value === 'hidden' || value === 'compact' || value === 'full') portable[key] = value;
      continue;
    }
    if (typeof value === 'boolean') portable[key] = value;
  }
  return Object.keys(portable).length > 0 ? portable : undefined;
}

function sanitizeRendererStorage(storage: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(storage)
      .filter(([key, value]) => key.length <= 200 && value.length <= 1_000_000)
      .slice(0, 100)
  );
}

export async function createSettingsArchive(
  appVersion: string,
  rendererStorage: Record<string, string>
): Promise<YodaSettingsArchive> {
  const allSettings = await appSettingsService.getAll();
  const appSettings: Partial<AppSettings> = {};
  for (const key of PORTABLE_APP_SETTINGS_KEYS) {
    const value = allSettings[key];
    Object.assign(appSettings, {
      [key]: key === 'maas' ? sanitizeMaasSettings(value as MaasSettings) : value,
    });
  }

  const rawRuntimeConfigs = await runtimeOverrideSettings.getOverrides();
  const runtimeConfigs = Object.fromEntries(
    Object.entries(rawRuntimeConfigs)
      .filter(([id]) => isValidRuntimeId(id))
      .map(([id, config]) => [
        id,
        sanitizeRuntimeConfig(runtimeCustomConfigEntrySchema.parse(config)),
      ])
  );
  const sidebar = sanitizeSidebar(await viewStateService.get('sidebar'));

  return {
    kind: YODA_SETTINGS_ARCHIVE_KIND,
    version: YODA_SETTINGS_ARCHIVE_VERSION,
    appVersion,
    exportedAt: new Date().toISOString(),
    data: {
      appSettings,
      runtimeConfigs,
      viewState: sidebar ? { sidebar } : {},
      rendererStorage: sanitizeRendererStorage(rendererStorage),
    },
  };
}

export function parseSettingsArchive(value: unknown): YodaSettingsArchive {
  if (!isRecord(value)) throw new Error('Invalid Yoda settings file.');
  if (value.kind !== YODA_SETTINGS_ARCHIVE_KIND) {
    throw new Error('This file is not a Yoda settings archive.');
  }
  if (value.version !== YODA_SETTINGS_ARCHIVE_VERSION) {
    throw new Error(`Unsupported Yoda settings archive version: ${String(value.version)}`);
  }
  if (!isRecord(value.data)) throw new Error('The Yoda settings archive has no data.');

  const rawAppSettings = isRecord(value.data.appSettings) ? value.data.appSettings : {};
  const appSettings: Partial<AppSettings> = {};
  for (const key of PORTABLE_APP_SETTINGS_KEYS) {
    if (rawAppSettings[key] === undefined) continue;
    Object.assign(appSettings, { [key]: APP_SETTINGS_SCHEMA_MAP[key].parse(rawAppSettings[key]) });
  }

  const rawRuntimeConfigs = isRecord(value.data.runtimeConfigs) ? value.data.runtimeConfigs : {};
  const runtimeConfigs = Object.fromEntries(
    Object.entries(rawRuntimeConfigs)
      .filter(([id]) => isValidRuntimeId(id))
      .map(([id, config]) => [
        id,
        sanitizeRuntimeConfig(runtimeCustomConfigEntrySchema.parse(config)),
      ])
  );
  const rawViewState = isRecord(value.data.viewState) ? value.data.viewState : {};
  const sidebar = sanitizeSidebar(rawViewState.sidebar);
  const rawRendererStorage = isRecord(value.data.rendererStorage) ? value.data.rendererStorage : {};
  const rendererStorage = sanitizeRendererStorage(
    Object.fromEntries(
      Object.entries(rawRendererStorage).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    )
  );

  return {
    kind: YODA_SETTINGS_ARCHIVE_KIND,
    version: YODA_SETTINGS_ARCHIVE_VERSION,
    appVersion: typeof value.appVersion === 'string' ? value.appVersion : 'unknown',
    exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : new Date(0).toISOString(),
    data: {
      appSettings,
      runtimeConfigs,
      viewState: sidebar ? { sidebar } : {},
      rendererStorage,
    },
  };
}

export async function applySettingsArchive(archive: YodaSettingsArchive): Promise<void> {
  await appSettingsService.replaceMany(archive.data.appSettings);
  const currentRuntimeConfigs = await runtimeOverrideSettings.getOverrides();
  const runtimeConfigs = Object.fromEntries(
    Object.entries(archive.data.runtimeConfigs).map(([id, config]) => [
      id,
      {
        ...config,
        env: {
          ...sensitiveEnvironment(currentRuntimeConfigs[id]?.env),
          ...config.env,
        },
      },
    ])
  );
  await runtimeOverrideSettings.replaceOverrides(runtimeConfigs);
  const sidebar = archive.data.viewState.sidebar;
  if (sidebar !== undefined) {
    const currentSidebar = await viewStateService.get('sidebar');
    await viewStateService.save('sidebar', {
      ...(isRecord(currentSidebar) ? currentSidebar : {}),
      ...(isRecord(sidebar) ? sidebar : {}),
    });
  }
}

export function settingsArchiveDigest(archive: YodaSettingsArchive): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(archive.data)))
    .digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}
