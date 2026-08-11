import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BROWSER_SESSION_HEALTH_CONFIG_VERSION,
  type BrowserSessionHealthConfig,
  type BrowserSessionHealthDiagnostic,
  type BrowserSessionHealthPersistedState,
  type BrowserSessionHealthTargetState,
  type BrowserSessionHealthTargetStatus,
} from '@shared/browser-session-health';
import {
  createBrowserSessionHealthStatus,
  DEFAULT_BROWSER_SESSION_HEALTH_CONFIG,
  normalizeBrowserSessionHealthTarget,
  redactBrowserSessionDiagnostic,
  sanitizeBrowserSessionUrl,
} from './policy';

const STATUS_STATES = new Set<BrowserSessionHealthTargetState>([
  'unknown',
  'checking',
  'fresh',
  'auth_required',
  'needs_human',
  'waiting_user',
  'network_error',
  'error',
]);

function cloneDefaultConfig(): BrowserSessionHealthConfig {
  return {
    ...DEFAULT_BROWSER_SESSION_HEALTH_CONFIG,
    targets: DEFAULT_BROWSER_SESSION_HEALTH_CONFIG.targets.map((target) => ({
      ...target,
      loginUrlPatterns: [...target.loginUrlPatterns],
      loginTitlePatterns: [...target.loginTitlePatterns],
      humanUrlPatterns: [...target.humanUrlPatterns],
      humanTitlePatterns: [...target.humanTitlePatterns],
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nullableIso(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function normalizeDiagnostic(value: unknown): BrowserSessionHealthDiagnostic | null {
  if (!isRecord(value)) return null;
  const allowedCodes = new Set<BrowserSessionHealthDiagnostic['code']>([
    'ego_not_running',
    'command_timeout',
    'command_failed',
    'invalid_response',
    'navigation_failed',
    'handoff_failed',
    'resume_failed',
    'ownership_changed',
    'store_error',
    'unknown_error',
  ]);
  const allowedOperations = new Set<BrowserSessionHealthDiagnostic['operation']>([
    'initialize',
    'probe',
    'handoff',
    'resume',
    'store',
  ]);
  const code = allowedCodes.has(value.code as BrowserSessionHealthDiagnostic['code'])
    ? (value.code as BrowserSessionHealthDiagnostic['code'])
    : 'unknown_error';
  const operation = allowedOperations.has(
    value.operation as BrowserSessionHealthDiagnostic['operation']
  )
    ? (value.operation as BrowserSessionHealthDiagnostic['operation'])
    : 'store';
  return {
    code,
    operation,
    message: redactBrowserSessionDiagnostic(value.message) || '会话健康检查遇到未知错误。',
    at: nullableIso(value.at) ?? new Date(0).toISOString(),
    retryable: value.retryable !== false,
  };
}

function normalizeStatus(targetId: string, value: unknown): BrowserSessionHealthTargetStatus {
  const base = createBrowserSessionHealthStatus(targetId);
  if (!isRecord(value)) return base;
  const state = STATUS_STATES.has(value.state as BrowserSessionHealthTargetState)
    ? (value.state as BrowserSessionHealthTargetState)
    : 'unknown';
  const ownership =
    value.ownership === 'agent' ||
    value.ownership === 'agentDelegatedToUser' ||
    value.ownership === 'user'
      ? value.ownership
      : 'unknown';
  return {
    targetId,
    state: state === 'checking' ? 'unknown' : state,
    checkedAt: nullableIso(value.checkedAt),
    stateChangedAt: nullableIso(value.stateChangedAt),
    lastFreshAt: nullableIso(value.lastFreshAt),
    consecutiveFresh:
      Number.isInteger(value.consecutiveFresh) && Number(value.consecutiveFresh) >= 0
        ? Number(value.consecutiveFresh)
        : 0,
    nextCheckAt: nullableIso(value.nextCheckAt),
    finalUrl: sanitizeBrowserSessionUrl(value.finalUrl),
    handoffUrl: sanitizeBrowserSessionUrl(value.handoffUrl),
    ownership,
    taskSpaceId:
      Number.isInteger(value.taskSpaceId) && Number(value.taskSpaceId) >= 0
        ? Number(value.taskSpaceId)
        : null,
    error: normalizeDiagnostic(value.error),
  };
}

export class BrowserSessionHealthJsonStore {
  readonly configPath: string;
  readonly statePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(readonly directory: string) {
    this.configPath = join(directory, 'config.json');
    this.statePath = join(directory, 'state.json');
  }

  async loadConfig(): Promise<BrowserSessionHealthConfig> {
    const raw = await this.readJson(this.configPath);
    if (!isRecord(raw) || !Array.isArray(raw.targets)) return cloneDefaultConfig();
    const targets = raw.targets.flatMap((value) => {
      if (!isRecord(value) || typeof value.id !== 'string') return [];
      try {
        return [
          normalizeBrowserSessionHealthTarget(
            {
              id: value.id,
              name: String(value.name ?? ''),
              url: String(value.url ?? ''),
              enabled: value.enabled === true,
              intervalMinutes: Number(value.intervalMinutes),
              loginUrlPatterns: Array.isArray(value.loginUrlPatterns)
                ? value.loginUrlPatterns.map(String)
                : [],
              loginTitlePatterns: Array.isArray(value.loginTitlePatterns)
                ? value.loginTitlePatterns.map(String)
                : [],
              humanUrlPatterns: Array.isArray(value.humanUrlPatterns)
                ? value.humanUrlPatterns.map(String)
                : [],
              humanTitlePatterns: Array.isArray(value.humanTitlePatterns)
                ? value.humanTitlePatterns.map(String)
                : [],
            },
            value.id
          ),
        ];
      } catch {
        return [];
      }
    });
    return {
      version: BROWSER_SESSION_HEALTH_CONFIG_VERSION,
      enabled: raw.enabled === true,
      targets,
    };
  }

  async loadState(): Promise<BrowserSessionHealthPersistedState> {
    const raw = await this.readJson(this.statePath);
    const source = isRecord(raw) && isRecord(raw.statuses) ? raw.statuses : {};
    return {
      version: BROWSER_SESSION_HEALTH_CONFIG_VERSION,
      statuses: Object.fromEntries(
        Object.entries(source).map(([targetId, status]) => [
          targetId,
          normalizeStatus(targetId, status),
        ])
      ),
    };
  }

  writeConfig(config: BrowserSessionHealthConfig): Promise<void> {
    const normalized: BrowserSessionHealthConfig = {
      version: BROWSER_SESSION_HEALTH_CONFIG_VERSION,
      enabled: config.enabled === true,
      targets: config.targets.map((target) =>
        normalizeBrowserSessionHealthTarget(target, target.id)
      ),
    };
    return this.enqueueWrite(this.configPath, normalized);
  }

  writeState(state: BrowserSessionHealthPersistedState): Promise<void> {
    const normalized: BrowserSessionHealthPersistedState = {
      version: BROWSER_SESSION_HEALTH_CONFIG_VERSION,
      statuses: Object.fromEntries(
        Object.entries(state.statuses).map(([targetId, status]) => [
          targetId,
          normalizeStatus(targetId, status),
        ])
      ),
    };
    return this.enqueueWrite(this.statePath, normalized);
  }

  private async readJson(path: string): Promise<unknown> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private enqueueWrite(path: string, value: unknown): Promise<void> {
    const pending = this.writeQueue.then(() => this.atomicWrite(path, value));
    this.writeQueue = pending.catch(() => undefined);
    return pending;
  }

  private async atomicWrite(path: string, value: unknown): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const temporaryPath = join(this.directory, `.${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, path);
      await chmod(path, 0o600);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
}
