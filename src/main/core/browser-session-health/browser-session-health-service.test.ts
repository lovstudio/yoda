import { describe, expect, it, vi } from 'vitest';
import type {
  BrowserSessionHealthConfig,
  BrowserSessionHealthPersistedState,
  BrowserSessionHealthTarget,
  BrowserSessionHealthTargetStatus,
} from '@shared/browser-session-health';
import {
  BrowserSessionHealthService,
  type BrowserSessionHealthEgoClient,
  type BrowserSessionHealthStore,
} from './browser-session-health-service';
import { EgoBrowserClientError } from './ego-browser-client';
import { createBrowserSessionHealthStatus } from './policy';

function clone<T>(value: T): T {
  return structuredClone(value);
}

class MemoryStore implements BrowserSessionHealthStore {
  config: BrowserSessionHealthConfig;
  state: BrowserSessionHealthPersistedState;
  configWrites = 0;
  stateWrites = 0;

  constructor(config: BrowserSessionHealthConfig, state?: BrowserSessionHealthPersistedState) {
    this.config = clone(config);
    this.state = clone(state ?? { version: 1, statuses: {} });
  }

  async loadConfig(): Promise<BrowserSessionHealthConfig> {
    return clone(this.config);
  }

  async loadState(): Promise<BrowserSessionHealthPersistedState> {
    return clone(this.state);
  }

  async writeConfig(config: BrowserSessionHealthConfig): Promise<void> {
    this.configWrites += 1;
    this.config = clone(config);
  }

  async writeState(state: BrowserSessionHealthPersistedState): Promise<void> {
    this.stateWrites += 1;
    this.state = clone(state);
  }
}

function target(id = 'target-1', overrides: Partial<BrowserSessionHealthTarget> = {}) {
  return {
    id,
    name: `控制台 ${id}`,
    url: `https://${id}.example.com/account`,
    enabled: false,
    intervalMinutes: 10,
    loginUrlPatterns: ['/login'],
    loginTitlePatterns: ['请登录'],
    humanUrlPatterns: ['/challenge'],
    humanTitlePatterns: ['人机验证'],
    ...overrides,
  } satisfies BrowserSessionHealthTarget;
}

function config(
  targets: BrowserSessionHealthTarget[],
  enabled = false
): BrowserSessionHealthConfig {
  return { version: 1, enabled, targets };
}

function makeClient(): {
  client: BrowserSessionHealthEgoClient;
  probe: ReturnType<typeof vi.fn<BrowserSessionHealthEgoClient['probe']>>;
  handoff: ReturnType<typeof vi.fn<BrowserSessionHealthEgoClient['handoff']>>;
  resume: ReturnType<typeof vi.fn<BrowserSessionHealthEgoClient['resumeAfterLogin']>>;
  focus: ReturnType<typeof vi.fn<BrowserSessionHealthEgoClient['focusHandoff']>>;
} {
  const probe = vi.fn<BrowserSessionHealthEgoClient['probe']>();
  const handoff = vi.fn<BrowserSessionHealthEgoClient['handoff']>();
  const resume = vi.fn<BrowserSessionHealthEgoClient['resumeAfterLogin']>();
  const focus = vi.fn<BrowserSessionHealthEgoClient['focusHandoff']>();
  return {
    client: { probe, handoff, resumeAfterLogin: resume, focusHandoff: focus },
    probe,
    handoff,
    resume,
    focus,
  };
}

function stateWith(
  statuses: BrowserSessionHealthTargetStatus[]
): BrowserSessionHealthPersistedState {
  return {
    version: 1,
    statuses: Object.fromEntries(statuses.map((status) => [status.targetId, status])),
  };
}

describe('BrowserSessionHealthService', () => {
  it('allows one manual check while disabled, then hard-stops on user ownership', async () => {
    const item = target();
    const store = new MemoryStore(config([item]));
    const { client, probe, handoff, resume } = makeClient();
    probe.mockResolvedValue({ kind: 'waiting_user', taskSpaceId: 3, ownership: 'user' });
    const service = new BrowserSessionHealthService({
      store,
      client,
      notifier: vi.fn(),
      random: () => 0.5,
    });

    const first = await service.runNow(item.id);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(first.targets[0]).toMatchObject({
      status: 'waiting_user',
      nextCheckAt: null,
      ownership: 'user',
      taskSpaceId: 3,
    });
    await service.runNow(item.id);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(handoff).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });

  it('breaks the whole run immediately when any task space is user-controlled', async () => {
    const first = target('first', { enabled: true });
    const second = target('second', { enabled: true });
    const store = new MemoryStore(config([first, second], true));
    const { client, probe } = makeClient();
    probe.mockResolvedValue({ kind: 'waiting_user', taskSpaceId: 4, ownership: 'user' });
    const setTimer = vi.fn(() => ({ unref: vi.fn() }) as unknown as ReturnType<typeof setTimeout>);
    const service = new BrowserSessionHealthService({
      store,
      client,
      notifier: vi.fn(),
      setTimer,
      clearTimer: vi.fn(),
    });

    await service.runNow();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith(first.url, 30_000);
    expect(setTimer).toHaveBeenCalledTimes(1);
  });

  it('hands off and notifies once per auth transition, and resumes only after explicit call', async () => {
    const item = target();
    const store = new MemoryStore(config([item]));
    const { client, probe, handoff, resume } = makeClient();
    probe
      .mockResolvedValueOnce({
        kind: 'page',
        taskSpaceId: 7,
        ownership: 'agent',
        finalUrl: 'https://target-1.example.com/login?return=private',
        title: '请登录',
      })
      .mockResolvedValueOnce({
        kind: 'page',
        taskSpaceId: 7,
        ownership: 'agent',
        finalUrl: 'https://target-1.example.com/account?renewed=1',
        title: '账户',
      });
    handoff.mockResolvedValue({
      kind: 'handed_off',
      taskSpaceId: 7,
      ownership: 'agentDelegatedToUser',
    });
    resume.mockResolvedValue({ kind: 'resumed', taskSpaceId: 7, ownership: 'agent' });
    const notifier = vi.fn();
    const service = new BrowserSessionHealthService({
      store,
      client,
      notifier,
      random: () => 0.5,
      now: () => Date.parse('2026-08-11T01:00:00.000Z'),
    });

    const attention = await service.runNow(item.id);
    expect(attention.targets[0]).toMatchObject({
      status: 'auth_required',
      handoffUrl: 'https://target-1.example.com/login',
      nextCheckAt: null,
      ownership: 'agentDelegatedToUser',
    });
    expect(attention).toMatchObject({ egoStatus: 'waiting_user', connected: false });
    expect(handoff).toHaveBeenCalledTimes(1);
    expect(notifier).toHaveBeenCalledTimes(1);
    expect(resume).not.toHaveBeenCalled();

    await service.runNow(item.id);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(notifier).toHaveBeenCalledTimes(1);

    await expect(service.removeTarget(item.id)).rejects.toThrow('不能删除');

    const resumed = await service.resumeAfterLogin(item.id);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(resumed.targets[0]).toMatchObject({
      status: 'fresh',
      finalUrl: 'https://target-1.example.com/account',
      handoffUrl: null,
      consecutiveHealthyChecks: 1,
      ownership: 'agent',
    });
    expect(notifier).toHaveBeenCalledTimes(1);
  });

  it('coalesces overlapping checks into one global flight', async () => {
    const item = target();
    const store = new MemoryStore(config([item]));
    const { client, probe } = makeClient();
    let resolveProbe = (
      _value: Awaited<ReturnType<BrowserSessionHealthEgoClient['probe']>>
    ): void => {
      throw new Error('probe resolver was not initialized');
    };
    probe.mockReturnValue(
      new Promise((resolve) => {
        resolveProbe = resolve;
      })
    );
    const service = new BrowserSessionHealthService({ store, client, notifier: vi.fn() });

    const first = service.runNow(item.id);
    const second = service.runNow(item.id);
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(1));
    resolveProbe({
      kind: 'page',
      taskSpaceId: 1,
      ownership: 'agent',
      finalUrl: item.url,
      title: '账户',
    });
    await Promise.all([first, second]);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('runs overdue enabled targets after wake without ever taking over automatically', async () => {
    const item = target('wake', { enabled: true });
    const status = createBrowserSessionHealthStatus(item.id);
    status.nextCheckAt = '2026-08-11T01:10:00.000Z';
    let now = Date.parse('2026-08-11T01:00:00.000Z');
    let resumeListener = (): void => {
      throw new Error('resume listener was not initialized');
    };
    const unsubscribe = vi.fn();
    const timers: Array<{ callback: () => void; milliseconds: number }> = [];
    const store = new MemoryStore(config([item], true), stateWith([status]));
    const { client, probe, resume } = makeClient();
    probe.mockResolvedValue({
      kind: 'page',
      taskSpaceId: 2,
      ownership: 'agent',
      finalUrl: item.url,
      title: '账户',
    });
    const service = new BrowserSessionHealthService({
      store,
      client,
      notifier: vi.fn(),
      now: () => now,
      random: () => 0.5,
      setTimer: (callback, milliseconds) => {
        timers.push({ callback, milliseconds });
        return { unref: vi.fn() } as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: vi.fn(),
      subscribeToResume: (listener) => {
        resumeListener = listener;
        return unsubscribe;
      },
    });

    await service.initialize();
    expect(timers.at(-1)?.milliseconds).toBe(10 * 60_000);
    expect(resume).not.toHaveBeenCalled();
    now = Date.parse('2026-08-11T01:20:00.000Z');
    resumeListener();
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(1));
    expect(resume).not.toHaveBeenCalled();

    service.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    await service.initialize();
    expect(resume).not.toHaveBeenCalled();
  });

  it('does not schedule a persisted waiting-user or attention state', async () => {
    const item = target('blocked', { enabled: true });
    const waiting = createBrowserSessionHealthStatus(item.id);
    waiting.state = 'waiting_user';
    waiting.ownership = 'user';
    waiting.nextCheckAt = null;
    const setTimer = vi.fn();
    const store = new MemoryStore(config([item], true), stateWith([waiting]));
    const { client, probe, resume } = makeClient();
    const service = new BrowserSessionHealthService({
      store,
      client,
      notifier: vi.fn(),
      setTimer,
      subscribeToResume: () => undefined,
    });

    await service.initialize();
    expect(setTimer).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });

  it('keeps unknown redirects in-band without handoff', async () => {
    const item = target();
    const store = new MemoryStore(config([item]));
    const { client, probe, handoff } = makeClient();
    probe.mockResolvedValue({
      kind: 'page',
      taskSpaceId: 2,
      ownership: 'agent',
      finalUrl: 'https://unrecognized.example.net/continue',
      title: '继续',
    });
    const service = new BrowserSessionHealthService({ store, client, notifier: vi.fn() });

    const snapshot = await service.runNow(item.id);
    expect(snapshot.targets[0]?.status).toBe('unknown');
    expect(handoff).not.toHaveBeenCalled();
  });

  it('records copyable timeout diagnostics and retries only on a later schedule', async () => {
    const item = target();
    const store = new MemoryStore(config([item]));
    const { client, probe, handoff } = makeClient();
    probe.mockRejectedValue(
      new EgoBrowserClientError(
        'GET https://example.com/account?token=secret timed out token=hidden',
        'command_timeout'
      )
    );
    const service = new BrowserSessionHealthService({
      store,
      client,
      notifier: vi.fn(),
      now: () => Date.parse('2026-08-11T01:00:00.000Z'),
      random: () => 0.5,
    });

    const snapshot = await service.runNow(item.id);
    expect(snapshot.targets[0]).toMatchObject({
      status: 'network_error',
      lastError: {
        code: 'command_timeout',
        operation: 'probe',
        retryable: true,
      },
      nextCheckAt: '2026-08-11T01:10:00.000Z',
    });
    expect(JSON.stringify(snapshot.targets[0]?.lastError)).not.toContain('secret');
    expect(JSON.stringify(snapshot.targets[0]?.lastError)).not.toContain('hidden');
    expect(handoff).not.toHaveBeenCalled();
  });

  it('validates resume target ids before touching ownership', async () => {
    const item = target();
    const store = new MemoryStore(config([item]));
    const { client, resume } = makeClient();
    const service = new BrowserSessionHealthService({ store, client, notifier: vi.fn() });

    await expect(service.resumeAfterLogin('')).rejects.toThrow('请指定');
    await expect(service.resumeAfterLogin('missing')).rejects.toThrow('目标不存在');
    await expect(service.resumeAfterLogin(item.id)).rejects.toThrow('等待登录或人工接管');
    expect(resume).not.toHaveBeenCalled();
  });
});
