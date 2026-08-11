import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EgoBrowserClient,
  resolveEgoBrowserCommand,
  type BrowserSessionCommandResult,
  type BrowserSessionCommandRunner,
  type EgoBrowserClientError,
} from './ego-browser-client';

const RESULT_PREFIX = '__YODA_BROWSER_SESSION_HEALTH__';

function commandResult(
  value: Record<string, unknown>,
  overrides: Partial<BrowserSessionCommandResult> = {}
): BrowserSessionCommandResult {
  return {
    stdout: `${RESULT_PREFIX}${JSON.stringify(value)}\n`,
    stderr: '',
    exitCode: 0,
    timedOut: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EgoBrowserClient', () => {
  it('lists task spaces first and immediately returns user ownership without browser actions', async () => {
    const runner = vi
      .fn<BrowserSessionCommandRunner>()
      .mockResolvedValue(
        commandResult({ kind: 'waiting_user', taskSpaceId: 4, ownership: 'user' })
      );
    const launch = vi.fn(async () => undefined);
    const client = new EgoBrowserClient({ runCommand: runner, launchEgo: launch });

    await expect(client.probe('https://example.com/account')).resolves.toEqual({
      kind: 'waiting_user',
      taskSpaceId: 4,
      ownership: 'user',
    });

    const script = runner.mock.calls[0]?.[2].input ?? '';
    expect(script.indexOf('listTaskSpaces()')).toBeLessThan(script.indexOf('useOrCreateTaskSpace'));
    expect(script.indexOf("existing.ownership !== 'agent'")).toBeLessThan(
      script.indexOf('ensureRealTab')
    );
    expect(script).toContain('"Yoda 会话保活"');
    expect(script).not.toMatch(
      /snapshotText|browserFetch|serverFetch|cookie|token|click|scroll|submit/i
    );
    expect(launch).not.toHaveBeenCalled();
  });

  it('uses only read-only navigation metadata and keeps the keeper tab open', async () => {
    const runner = vi.fn<BrowserSessionCommandRunner>().mockResolvedValue(
      commandResult({
        kind: 'page',
        taskSpaceId: 5,
        ownership: 'agent',
        finalUrl: 'https://example.com/account?private=1',
        title: '账户',
      })
    );
    const client = new EgoBrowserClient({ runCommand: runner });
    await expect(client.probe('https://example.com/account')).resolves.toMatchObject({
      kind: 'page',
      taskSpaceId: 5,
    });
    const script = runner.mock.calls[0]?.[2].input ?? '';
    expect(script).toContain('ensureRealTab()');
    expect(script).toContain('if (realTab)');
    expect(script).toContain('gotoAndWait');
    expect(script).toContain('tab = await currentTab()');
    expect(script).toContain('openOrReuseTab');
    expect(script.indexOf('gotoAndWait')).toBeLessThan(script.indexOf('openOrReuseTab'));
    expect(script).toContain('pageInfo()');
    expect(script).not.toContain('closeTab');
    expect(runner.mock.calls[0]?.[0]).toBe(resolveEgoBrowserCommand());
    expect(runner.mock.calls[0]?.[1]).toEqual(['nodejs']);
  });

  it('contains takeOverTaskSpace only in the explicit resume method', async () => {
    const runner = vi
      .fn<BrowserSessionCommandRunner>()
      .mockResolvedValueOnce(
        commandResult({
          kind: 'handed_off',
          taskSpaceId: 8,
          ownership: 'agentDelegatedToUser',
        })
      )
      .mockResolvedValueOnce(
        commandResult({ kind: 'resumed', taskSpaceId: 8, ownership: 'agent' })
      );
    const client = new EgoBrowserClient({ runCommand: runner });

    await client.handoff();
    await client.resumeAfterLogin();

    const handoffScript = runner.mock.calls[0]?.[2].input ?? '';
    const resumeScript = runner.mock.calls[1]?.[2].input ?? '';
    expect(handoffScript).toContain('handOffTaskSpace');
    expect(handoffScript).not.toContain('takeOverTaskSpace');
    expect(resumeScript).toContain('takeOverTaskSpace');
    expect(resumeScript.match(/listTaskSpaces\(\)/g)).toHaveLength(2);
    expect(resumeScript.indexOf('listTaskSpaces()')).toBeLessThan(
      resumeScript.indexOf('takeOverTaskSpace')
    );
  });

  it('turns a skipped handoff into an explicit handoff failure', async () => {
    const runner = vi
      .fn<BrowserSessionCommandRunner>()
      .mockResolvedValue(
        commandResult({ kind: 'handoff_failed', taskSpaceId: 8, ownership: 'agent' })
      );
    const client = new EgoBrowserClient({ runCommand: runner });
    await expect(client.handoff()).rejects.toMatchObject({ code: 'handoff_failed' });
  });

  it('starts ego lite in the background once and retries a bounded connection failure', async () => {
    const runner = vi
      .fn<BrowserSessionCommandRunner>()
      .mockResolvedValueOnce({
        stdout: '',
        stderr: 'connect ECONNREFUSED',
        exitCode: 1,
        timedOut: false,
      })
      .mockResolvedValueOnce(
        commandResult({
          kind: 'page',
          taskSpaceId: 2,
          ownership: 'agent',
          finalUrl: 'https://example.com/account',
          title: '账户',
        })
      );
    const launch = vi.fn(async () => undefined);
    const wait = vi.fn(async () => undefined);
    const client = new EgoBrowserClient({
      runCommand: runner,
      launchEgo: launch,
      wait,
      startupRetries: 2,
    });

    await client.probe('https://example.com/account');
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledWith(false);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it('does not retry timeouts or ownership changes', async () => {
    const timeoutRunner = vi.fn<BrowserSessionCommandRunner>().mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: null,
      timedOut: true,
    });
    const launch = vi.fn(async () => undefined);
    const timeoutClient = new EgoBrowserClient({ runCommand: timeoutRunner, launchEgo: launch });
    await expect(timeoutClient.probe('https://example.com/account')).rejects.toMatchObject({
      code: 'command_timeout',
    } satisfies Partial<EgoBrowserClientError>);
    expect(timeoutRunner).toHaveBeenCalledTimes(1);
    expect(launch).not.toHaveBeenCalled();

    const ownershipRunner = vi.fn<BrowserSessionCommandRunner>().mockResolvedValue({
      stdout: '',
      stderr: 'user is controlling this task space',
      exitCode: 1,
      timedOut: false,
    });
    const ownershipClient = new EgoBrowserClient({
      runCommand: ownershipRunner,
      launchEgo: launch,
    });
    await expect(ownershipClient.probe('https://example.com/account')).rejects.toMatchObject({
      code: 'ownership_changed',
    } satisfies Partial<EgoBrowserClientError>);
    expect(ownershipRunner).toHaveBeenCalledTimes(1);
  });

  it('focuses handed-off Ego without taking over and honors EGO_BROWSER_PATH', async () => {
    const launch = vi.fn(async () => undefined);
    const client = new EgoBrowserClient({
      runCommand: vi.fn<BrowserSessionCommandRunner>(),
      launchEgo: launch,
    });
    await client.focusHandoff();
    expect(launch).toHaveBeenCalledWith(true);

    const previous = process.env.EGO_BROWSER_PATH;
    process.env.EGO_BROWSER_PATH = '/opt/ego-browser-custom';
    try {
      expect(resolveEgoBrowserCommand()).toBe('/opt/ego-browser-custom');
    } finally {
      if (previous === undefined) delete process.env.EGO_BROWSER_PATH;
      else process.env.EGO_BROWSER_PATH = previous;
    }
  });
});
