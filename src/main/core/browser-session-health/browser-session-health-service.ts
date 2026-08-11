import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  BROWSER_SESSION_HEALTH_CONFIG_VERSION,
  BROWSER_SESSION_HEALTH_TASK_SPACE_NAME,
  type BrowserSessionHealthAttention,
  type BrowserSessionHealthConfig,
  type BrowserSessionHealthEgoStatus,
  type BrowserSessionHealthOwnership,
  type BrowserSessionHealthPersistedState,
  type BrowserSessionHealthSnapshot,
  type BrowserSessionHealthTarget,
  type BrowserSessionHealthTargetInput,
  type BrowserSessionHealthTargetSnapshot,
  type BrowserSessionHealthTargetStatus,
} from '@shared/browser-session-health';
import {
  EgoBrowserClient,
  EgoBrowserClientError,
  type EgoBrowserControlResult,
  type EgoBrowserProbeResult,
} from './ego-browser-client';
import {
  notifyBrowserSessionAttention,
  type BrowserSessionHealthNotifier,
} from './electron-notifier';
import { BrowserSessionHealthJsonStore } from './json-store';
import {
  browserSessionHealthDiagnostic,
  classifyBrowserSessionNavigation,
  createBrowserSessionHealthStatus,
  DEFAULT_BROWSER_SESSION_HEALTH_CONFIG,
  evolveBrowserSessionHealthStatus,
  isBrowserSessionAttentionState,
  isBrowserSessionBlockedState,
  makeBrowserSessionAttention,
  nextBrowserSessionHealthDelayMs,
  normalizeBrowserSessionHealthTarget,
  shouldNotifyBrowserSessionTransition,
} from './policy';

export interface BrowserSessionHealthStore {
  loadConfig(): Promise<BrowserSessionHealthConfig>;
  loadState(): Promise<BrowserSessionHealthPersistedState>;
  writeConfig(config: BrowserSessionHealthConfig): Promise<void>;
  writeState(state: BrowserSessionHealthPersistedState): Promise<void>;
}

export interface BrowserSessionHealthEgoClient {
  probe(url: string, navigationTimeoutMs?: number): Promise<EgoBrowserProbeResult>;
  handoff(): Promise<EgoBrowserControlResult>;
  resumeAfterLogin(): Promise<EgoBrowserControlResult>;
  focusHandoff(): Promise<void>;
}

type TimerHandle = ReturnType<typeof setTimeout>;

export interface BrowserSessionHealthServiceOptions {
  store?: BrowserSessionHealthStore;
  client?: BrowserSessionHealthEgoClient;
  notifier?: BrowserSessionHealthNotifier;
  now?: () => number;
  random?: () => number;
  setTimer?: (callback: () => void, milliseconds: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  subscribeToResume?: (callback: () => void) => void | (() => void);
  navigationTimeoutMs?: number;
}

function cloneConfig(config: BrowserSessionHealthConfig): BrowserSessionHealthConfig {
  return {
    ...config,
    targets: config.targets.map((target) => ({
      ...target,
      loginUrlPatterns: [...target.loginUrlPatterns],
      loginTitlePatterns: [...target.loginTitlePatterns],
      humanUrlPatterns: [...target.humanUrlPatterns],
      humanTitlePatterns: [...target.humanTitlePatterns],
    })),
  };
}

function cloneStatus(status: BrowserSessionHealthTargetStatus): BrowserSessionHealthTargetStatus {
  return {
    ...status,
    error: status.error ? { ...status.error } : null,
  };
}

function isDue(status: BrowserSessionHealthTargetStatus, now: number): boolean {
  if (!status.nextCheckAt) return true;
  const scheduled = Date.parse(status.nextCheckAt);
  return !Number.isFinite(scheduled) || scheduled <= now;
}

export class BrowserSessionHealthService {
  private store: BrowserSessionHealthStore | null;
  private readonly client: BrowserSessionHealthEgoClient;
  private readonly notifier: BrowserSessionHealthNotifier;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly setTimer: (callback: () => void, milliseconds: number) => TimerHandle;
  private readonly clearTimer: (handle: TimerHandle) => void;
  private readonly subscribeToResume?: BrowserSessionHealthServiceOptions['subscribeToResume'];
  private readonly navigationTimeoutMs: number;
  private config = cloneConfig(DEFAULT_BROWSER_SESSION_HEALTH_CONFIG);
  private state: BrowserSessionHealthPersistedState = {
    version: BROWSER_SESSION_HEALTH_CONFIG_VERSION,
    statuses: {},
  };
  private initialized = false;
  private initialization: Promise<void> | null = null;
  private disposed = false;
  private timer: TimerHandle | null = null;
  private unsubscribeResume: (() => void) | null = null;
  private inFlight: Promise<BrowserSessionHealthSnapshot> | null = null;
  private checkingTargets = new Set<string>();
  private egoStatus: BrowserSessionHealthEgoStatus = 'unknown';

  constructor(options: BrowserSessionHealthServiceOptions = {}) {
    this.store = options.store ?? null;
    this.client = options.client ?? new EgoBrowserClient();
    this.notifier = options.notifier ?? notifyBrowserSessionAttention;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.subscribeToResume = options.subscribeToResume;
    this.navigationTimeoutMs = Math.max(1_000, options.navigationTimeoutMs ?? 30_000);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initialization) return this.initialization;
    this.initialization = this.initializeOnce().finally(() => {
      this.initialization = null;
    });
    return this.initialization;
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    this.unsubscribeResume?.();
    this.unsubscribeResume = null;
    this.initialized = false;
    this.checkingTargets.clear();
  }

  async getSnapshot(): Promise<BrowserSessionHealthSnapshot> {
    await this.initialize();
    return this.snapshot();
  }

  async setEnabled(enabled: boolean): Promise<BrowserSessionHealthSnapshot> {
    await this.initialize();
    this.config = { ...this.config, enabled: enabled === true };
    const now = this.now();
    if (this.config.enabled) {
      for (const target of this.config.targets) {
        const status = this.statusFor(target.id);
        if (target.enabled && !isBrowserSessionBlockedState(status.state)) {
          status.nextCheckAt = new Date(now).toISOString();
        }
      }
    }
    await this.requireStore().writeConfig(this.config);
    await this.persistState();
    this.scheduleNext();
    return this.snapshot();
  }

  async upsertTarget(
    input: BrowserSessionHealthTargetInput
  ): Promise<BrowserSessionHealthSnapshot> {
    await this.initialize();
    const existing = input.id
      ? this.config.targets.find((target) => target.id === input.id)
      : undefined;
    const id = existing?.id ?? input.id ?? randomUUID();
    const target = normalizeBrowserSessionHealthTarget(
      {
        id,
        name: input.name,
        url: input.url,
        enabled: input.enabled ?? existing?.enabled ?? false,
        intervalMinutes: input.intervalMinutes ?? existing?.intervalMinutes,
        loginUrlPatterns: input.loginUrlPatterns ?? existing?.loginUrlPatterns,
        loginTitlePatterns: input.loginTitlePatterns ?? existing?.loginTitlePatterns,
        humanUrlPatterns: input.humanUrlPatterns ?? existing?.humanUrlPatterns,
        humanTitlePatterns: input.humanTitlePatterns ?? existing?.humanTitlePatterns,
        loginUrlMarker: input.loginUrlMarker,
        loginTitleMarker: input.loginTitleMarker,
      },
      id
    );
    const targets = existing
      ? this.config.targets.map((candidate) => (candidate.id === id ? target : candidate))
      : [...this.config.targets, target];
    this.config = { ...this.config, targets };
    const status = this.statusFor(id);
    if (this.config.enabled && target.enabled && !isBrowserSessionBlockedState(status.state)) {
      status.nextCheckAt ??= new Date(this.now()).toISOString();
    }
    await this.requireStore().writeConfig(this.config);
    await this.persistState();
    this.scheduleNext();
    return this.snapshot();
  }

  async removeTarget(targetId: string): Promise<BrowserSessionHealthSnapshot> {
    await this.initialize();
    const existing = this.config.targets.find((target) => target.id === targetId);
    if (!existing) return this.snapshot();
    if (isBrowserSessionBlockedState(this.statusFor(targetId).state)) {
      throw new Error('等待登录或人工接管的目标不能删除，请先完成接管。');
    }
    this.config = {
      ...this.config,
      targets: this.config.targets.filter((target) => target.id !== targetId),
    };
    delete this.state.statuses[targetId];
    await this.requireStore().writeConfig(this.config);
    await this.persistState();
    this.scheduleNext();
    return this.snapshot();
  }

  async runNow(targetId?: string): Promise<BrowserSessionHealthSnapshot> {
    await this.initialize();
    const targets = targetId
      ? this.config.targets.filter((target) => target.id === targetId)
      : [...this.config.targets];
    return this.singleFlight(() => this.runTargets(targets));
  }

  async resumeAfterLogin(targetId: string): Promise<BrowserSessionHealthSnapshot> {
    await this.initialize();
    const normalizedTargetId = String(targetId ?? '').trim();
    if (!normalizedTargetId) throw new Error('请指定需要恢复的会话健康目标。');
    if (!this.config.targets.some((target) => target.id === normalizedTargetId)) {
      throw new Error(`会话健康目标不存在：${targetId}`);
    }
    if (this.inFlight) await this.inFlight;
    if (!isBrowserSessionBlockedState(this.statusFor(normalizedTargetId).state)) {
      throw new Error('只有等待登录或人工接管的目标才需要恢复。');
    }
    return this.singleFlight(async () => {
      const targets = this.config.targets.filter((target) => target.id === normalizedTargetId);
      let control: EgoBrowserControlResult;
      try {
        control = await this.client.resumeAfterLogin();
        this.egoStatus = control.kind === 'waiting_user' ? 'waiting_user' : 'connected';
      } catch (error) {
        this.egoStatus =
          error instanceof EgoBrowserClientError && error.code === 'ego_not_running'
            ? 'not_running'
            : 'error';
        const at = new Date(this.now()).toISOString();
        for (const target of targets) {
          const status = this.statusFor(target.id);
          status.error = browserSessionHealthDiagnostic(
            error,
            'resume',
            at,
            error instanceof EgoBrowserClientError ? error.code : 'resume_failed'
          );
        }
        await this.persistState();
        this.scheduleNext();
        return this.snapshot();
      }

      const at = new Date(this.now()).toISOString();
      if (control.kind === 'waiting_user') {
        for (const target of targets) {
          const status = this.statusFor(target.id);
          status.state = 'waiting_user';
          status.nextCheckAt = null;
          status.ownership = control.ownership;
          status.taskSpaceId = control.taskSpaceId;
        }
        await this.persistState();
        this.scheduleNext();
        return this.snapshot();
      }
      for (const target of this.config.targets) {
        const previous = this.statusFor(target.id);
        if (!isBrowserSessionBlockedState(previous.state)) continue;
        this.state.statuses[target.id] = {
          ...previous,
          state: 'unknown',
          stateChangedAt: at,
          nextCheckAt: at,
          handoffUrl: null,
          ownership: control.ownership,
          taskSpaceId: control.taskSpaceId,
          error: null,
        };
      }
      await this.persistState();
      return this.runTargets(targets);
    });
  }

  async focusHandoff(): Promise<void> {
    await this.client.focusHandoff();
  }

  private async initializeOnce(): Promise<void> {
    this.disposed = false;
    try {
      const store = await this.getOrCreateStore();
      const [config, state] = await Promise.all([store.loadConfig(), store.loadState()]);
      this.config = config;
      this.state = state;
      this.reconcileStatuses();
      await store.writeConfig(this.config);
      await store.writeState(this.state);
    } catch (error) {
      this.config = cloneConfig(DEFAULT_BROWSER_SESSION_HEALTH_CONFIG);
      const at = new Date(this.now()).toISOString();
      this.state = {
        version: BROWSER_SESSION_HEALTH_CONFIG_VERSION,
        statuses: Object.fromEntries(
          this.config.targets.map((target) => {
            const status = createBrowserSessionHealthStatus(target.id);
            status.state = 'error';
            status.checkedAt = at;
            status.stateChangedAt = at;
            status.error = browserSessionHealthDiagnostic(error, 'initialize', at, 'store_error');
            return [target.id, status];
          })
        ),
      };
      this.egoStatus = 'error';
    }
    this.initialized = true;
    await this.attachResumeListener();
    this.scheduleNext();
  }

  private async getOrCreateStore(): Promise<BrowserSessionHealthStore> {
    if (this.store) return this.store;
    const { app } = await import('electron');
    this.store = new BrowserSessionHealthJsonStore(
      join(app.getPath('userData'), 'browser-session-health')
    );
    return this.store;
  }

  private requireStore(): BrowserSessionHealthStore {
    if (!this.store) throw new Error('会话健康存储尚未初始化。');
    return this.store;
  }

  private reconcileStatuses(): void {
    const targetIds = new Set(this.config.targets.map((target) => target.id));
    this.state = {
      version: BROWSER_SESSION_HEALTH_CONFIG_VERSION,
      statuses: Object.fromEntries(
        this.config.targets.map((target) => [
          target.id,
          this.state.statuses[target.id] ?? createBrowserSessionHealthStatus(target.id),
        ])
      ),
    };
    for (const targetId of Object.keys(this.state.statuses)) {
      if (!targetIds.has(targetId)) delete this.state.statuses[targetId];
    }
  }

  private statusFor(targetId: string): BrowserSessionHealthTargetStatus {
    return (this.state.statuses[targetId] ??= createBrowserSessionHealthStatus(targetId));
  }

  private async persistState(): Promise<void> {
    await this.requireStore().writeState(this.state);
  }

  private async runTargets(
    targets: BrowserSessionHealthTarget[]
  ): Promise<BrowserSessionHealthSnapshot> {
    try {
      if (this.hasGlobalBlock()) return this.snapshot();
      for (const target of targets) {
        const status = this.statusFor(target.id);
        if (isBrowserSessionBlockedState(status.state)) continue;
        const state = await this.probeTarget(target);
        if (isBrowserSessionBlockedState(state)) break;
      }
      return this.snapshot();
    } finally {
      this.scheduleNext();
    }
  }

  private async probeTarget(
    target: BrowserSessionHealthTarget
  ): Promise<BrowserSessionHealthTargetStatus['state']> {
    const previous = cloneStatus(this.statusFor(target.id));
    this.checkingTargets.add(target.id);
    try {
      const result = await this.client.probe(target.url, this.navigationTimeoutMs);
      const checkedAtMs = this.now();
      const checkedAt = new Date(checkedAtMs).toISOString();
      if (result.kind === 'waiting_user') {
        this.egoStatus = 'waiting_user';
        this.state.statuses[target.id] = evolveBrowserSessionHealthStatus(previous, {
          targetId: target.id,
          state: 'waiting_user',
          checkedAt,
          nextCheckAt: null,
          ownership: result.ownership,
          taskSpaceId: result.taskSpaceId,
        });
        await this.persistState();
        return 'waiting_user';
      }

      this.egoStatus = 'connected';
      const outcome =
        result.kind === 'dialog'
          ? { state: 'needs_human' as const, finalUrl: result.finalUrl }
          : classifyBrowserSessionNavigation(target, result.finalUrl, result.title);
      let ownership: BrowserSessionHealthOwnership = result.ownership;
      let taskSpaceId = result.taskSpaceId;
      let handoffError: BrowserSessionHealthTargetStatus['error'] = null;
      if (isBrowserSessionAttentionState(outcome.state)) {
        try {
          const handoff = await this.client.handoff();
          ownership = handoff.ownership;
          taskSpaceId = handoff.taskSpaceId ?? taskSpaceId;
          if (handoff.kind === 'handed_off' || handoff.kind === 'waiting_user') {
            this.egoStatus = 'waiting_user';
          }
        } catch (error) {
          handoffError = browserSessionHealthDiagnostic(
            error,
            'handoff',
            checkedAt,
            error instanceof EgoBrowserClientError ? error.code : 'handoff_failed'
          );
        }
      }

      const next = evolveBrowserSessionHealthStatus(previous, {
        targetId: target.id,
        state: outcome.state,
        checkedAt,
        nextCheckAt: isBrowserSessionAttentionState(outcome.state)
          ? null
          : this.nextCheckAt(target, checkedAtMs),
        finalUrl: outcome.finalUrl,
        handoffUrl: outcome.finalUrl,
        ownership,
        taskSpaceId,
        error: handoffError,
      });
      this.state.statuses[target.id] = next;
      await this.persistState();
      if (shouldNotifyBrowserSessionTransition(previous, next)) {
        const attention = makeBrowserSessionAttention(target, next);
        if (attention) await Promise.resolve(this.notifier(attention)).catch(() => undefined);
      }
      return next.state;
    } catch (error) {
      const checkedAtMs = this.now();
      const checkedAt = new Date(checkedAtMs).toISOString();
      const code = error instanceof EgoBrowserClientError ? error.code : 'navigation_failed';
      const waitingUser = code === 'ownership_changed';
      this.egoStatus =
        code === 'ego_not_running' ? 'not_running' : waitingUser ? 'waiting_user' : 'error';
      this.state.statuses[target.id] = evolveBrowserSessionHealthStatus(previous, {
        targetId: target.id,
        state: waitingUser
          ? 'waiting_user'
          : code === 'invalid_response'
            ? 'error'
            : 'network_error',
        checkedAt,
        nextCheckAt: waitingUser ? null : this.nextCheckAt(target, checkedAtMs),
        ownership: previous.ownership,
        taskSpaceId: previous.taskSpaceId,
        error: browserSessionHealthDiagnostic(error, 'probe', checkedAt, code),
      });
      await this.persistState();
      return this.state.statuses[target.id].state;
    } finally {
      this.checkingTargets.delete(target.id);
    }
  }

  private nextCheckAt(target: BrowserSessionHealthTarget, now: number): string {
    return new Date(
      now + nextBrowserSessionHealthDelayMs(target.intervalMinutes, this.random)
    ).toISOString();
  }

  private singleFlight(
    operation: () => Promise<BrowserSessionHealthSnapshot>
  ): Promise<BrowserSessionHealthSnapshot> {
    if (this.inFlight) return this.inFlight;
    const pending = operation().finally(() => {
      if (this.inFlight === pending) this.inFlight = null;
    });
    this.inFlight = pending;
    return pending;
  }

  private scheduleNext(): void {
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    if (this.disposed || !this.initialized || !this.config.enabled || this.hasGlobalBlock()) {
      return;
    }
    const now = this.now();
    const dueTimes = this.config.targets.flatMap((target) => {
      if (!target.enabled) return [];
      const status = this.statusFor(target.id);
      if (isBrowserSessionBlockedState(status.state)) return [];
      const parsed = status.nextCheckAt ? Date.parse(status.nextCheckAt) : now;
      return [Number.isFinite(parsed) ? parsed : now];
    });
    if (dueTimes.length === 0) return;
    const milliseconds = Math.max(0, Math.min(2_147_483_647, Math.min(...dueTimes) - now));
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.runScheduledDueTargets();
    }, milliseconds);
    this.timer.unref?.();
  }

  private async runScheduledDueTargets(): Promise<BrowserSessionHealthSnapshot> {
    if (!this.config.enabled || this.disposed || this.hasGlobalBlock()) return this.snapshot();
    const now = this.now();
    const due = this.config.targets.filter((target) => {
      if (!target.enabled) return false;
      const status = this.statusFor(target.id);
      return !isBrowserSessionBlockedState(status.state) && isDue(status, now);
    });
    return this.singleFlight(() => this.runTargets(due));
  }

  private async attachResumeListener(): Promise<void> {
    const listener = () => {
      void this.runScheduledDueTargets();
    };
    if (this.subscribeToResume) {
      this.unsubscribeResume = this.subscribeToResume(listener) ?? null;
      return;
    }
    try {
      const { powerMonitor } = await import('electron');
      powerMonitor.on('resume', listener);
      this.unsubscribeResume = () => powerMonitor.removeListener('resume', listener);
    } catch {
      this.unsubscribeResume = null;
    }
  }

  private hasGlobalBlock(): boolean {
    return this.config.targets.some((target) =>
      isBrowserSessionBlockedState(this.statusFor(target.id).state)
    );
  }

  private snapshot(): BrowserSessionHealthSnapshot {
    const statuses = Object.fromEntries(
      Object.entries(this.state.statuses).map(([targetId, status]) => [
        targetId,
        cloneStatus(status),
      ])
    );
    const targets: BrowserSessionHealthTargetSnapshot[] = this.config.targets.map((target) => {
      const status = statuses[target.id] ?? createBrowserSessionHealthStatus(target.id);
      return {
        ...target,
        loginUrlPatterns: [...target.loginUrlPatterns],
        loginTitlePatterns: [...target.loginTitlePatterns],
        humanUrlPatterns: [...target.humanUrlPatterns],
        humanTitlePatterns: [...target.humanTitlePatterns],
        status: this.checkingTargets.has(target.id) ? 'checking' : status.state,
        lastCheckedAt: status.checkedAt,
        consecutiveHealthyChecks: status.consecutiveFresh,
        lastFreshAt: status.lastFreshAt,
        nextCheckAt: status.nextCheckAt,
        lastError: status.error ? { ...status.error } : null,
        finalUrl: status.finalUrl,
        handoffUrl: status.handoffUrl,
        ownership: status.ownership,
        taskSpaceId: status.taskSpaceId,
      };
    });
    const attention = this.firstAttention(targets, statuses);
    const latest = [...Object.values(statuses)]
      .filter((status) => status.checkedAt)
      .sort((left, right) => String(right.checkedAt).localeCompare(String(left.checkedAt)))[0];
    return {
      config: cloneConfig(this.config),
      targets,
      statuses,
      attention,
      connected: this.egoStatus === 'connected',
      egoStatus: this.egoStatus,
      taskSpaceName: BROWSER_SESSION_HEALTH_TASK_SPACE_NAME,
      taskSpaceId: attention
        ? (statuses[attention.targetId]?.taskSpaceId ?? null)
        : (latest?.taskSpaceId ?? null),
      ownership: attention
        ? (statuses[attention.targetId]?.ownership ?? 'unknown')
        : (latest?.ownership ?? 'unknown'),
      checkedAt: latest?.checkedAt ?? null,
    };
  }

  private firstAttention(
    targets: BrowserSessionHealthTargetSnapshot[],
    statuses: Record<string, BrowserSessionHealthTargetStatus>
  ): BrowserSessionHealthAttention | null {
    for (const target of targets) {
      const attention = makeBrowserSessionAttention(target, statuses[target.id]);
      if (attention) return attention;
    }
    return null;
  }
}

export const browserSessionHealthService = new BrowserSessionHealthService();
