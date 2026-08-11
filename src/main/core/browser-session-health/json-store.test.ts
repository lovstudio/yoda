import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  BrowserSessionHealthConfig,
  BrowserSessionHealthPersistedState,
} from '@shared/browser-session-health';
import { BrowserSessionHealthJsonStore } from './json-store';
import { createBrowserSessionHealthStatus } from './policy';

const temporaryDirectories: string[] = [];

async function makeStore(): Promise<BrowserSessionHealthJsonStore> {
  const directory = await mkdtemp(join(tmpdir(), 'yoda-browser-session-health-'));
  temporaryDirectories.push(directory);
  return new BrowserSessionHealthJsonStore(directory);
}

function config(enabled = false): BrowserSessionHealthConfig {
  return {
    version: 1,
    enabled,
    targets: [
      {
        id: 'target-1',
        name: '控制台',
        url: 'https://console.example.com/account?private=1#section',
        enabled: true,
        intervalMinutes: 10,
        loginUrlPatterns: ['/login?return=secret'],
        loginTitlePatterns: ['请登录'],
        humanUrlPatterns: ['/challenge'],
        humanTitlePatterns: ['人机验证'],
      },
    ],
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('BrowserSessionHealthJsonStore', () => {
  it('atomically stores config and state with 0600 files and sanitized URLs', async () => {
    const store = await makeStore();
    const status = createBrowserSessionHealthStatus('target-1');
    status.state = 'auth_required';
    status.checkedAt = '2026-08-11T01:00:00.000Z';
    status.finalUrl = 'https://console.example.com/login?token=secret#section';
    status.handoffUrl = status.finalUrl;
    status.taskSpaceId = 9;
    status.ownership = 'agentDelegatedToUser';
    const state: BrowserSessionHealthPersistedState = {
      version: 1,
      statuses: { 'target-1': status },
    };

    await store.writeConfig(config());
    await store.writeState(state);

    expect((await stat(store.configPath)).mode & 0o777).toBe(0o600);
    expect((await stat(store.statePath)).mode & 0o777).toBe(0o600);
    expect((await stat(store.directory)).mode & 0o777).toBe(0o700);
    const configText = await readFile(store.configPath, 'utf8');
    const stateText = await readFile(store.statePath, 'utf8');
    expect(configText).not.toContain('private=1');
    expect(configText).not.toContain('return=secret');
    expect(stateText).not.toContain('token=secret');
    expect((await store.loadConfig()).targets[0]?.url).toBe('https://console.example.com/account');
    expect((await store.loadState()).statuses['target-1']?.finalUrl).toBe(
      'https://console.example.com/login'
    );
    expect(await readdir(store.directory)).toEqual(['config.json', 'state.json']);
  });

  it('serializes concurrent writes without leaving temporary files', async () => {
    const store = await makeStore();
    await Promise.all([
      store.writeConfig(config(false)),
      store.writeConfig(config(true)),
      store.writeConfig(config(false)),
    ]);
    expect((await store.loadConfig()).enabled).toBe(false);
    expect(await readdir(store.directory)).toEqual(['config.json']);
  });

  it('loads a disabled product-neutral default when no files exist', async () => {
    const store = await makeStore();
    await expect(store.loadConfig()).resolves.toEqual({ version: 1, enabled: false, targets: [] });
    await expect(store.loadState()).resolves.toEqual({ version: 1, statuses: {} });
  });
});
