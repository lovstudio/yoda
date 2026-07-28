import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SessionStateRootsCatalog,
  withRuntimeStateRoot,
  type SessionStateRootsStorage,
} from './session-state-roots';

describe('SessionStateRootsCatalog', () => {
  let directory: string;
  let stored: Awaited<ReturnType<SessionStateRootsStorage['read']>>;
  let catalog: SessionStateRootsCatalog;

  beforeEach(async () => {
    directory = join(process.cwd(), '.tmp-session-state-roots', crypto.randomUUID());
    await mkdir(directory, { recursive: true });
    stored = {};
    catalog = new SessionStateRootsCatalog({
      read: async () => structuredClone(stored),
      write: async (value) => {
        stored = structuredClone(value);
      },
    });
  });

  afterEach(async () => {
    await import('node:fs/promises').then(({ rm }) =>
      rm(directory, { recursive: true, force: true })
    );
  });

  it('includes the default, configured, remembered, and profile roots', async () => {
    const defaultRoot = join(directory, '.codex');
    const configuredRoot = join(directory, 'configured-codex');
    const rememberedRoot = join(directory, 'remembered-codex');
    const profileRoot = join(defaultRoot, 'other-account');
    await mkdir(join(profileRoot, 'sessions'), { recursive: true });
    await mkdir(configuredRoot, { recursive: true });
    await mkdir(rememberedRoot, { recursive: true });
    stored = { codex: [rememberedRoot] };

    const roots = await catalog.list(
      'codex',
      { cli: 'codex', env: { CODEX_HOME: configuredRoot } },
      { home: directory, processEnv: {} }
    );

    expect(roots).toEqual([defaultRoot, configuredRoot, rememberedRoot, profileRoot]);
    expect(stored.codex).toEqual(roots);
  });

  it('discovers Claude account roots with a projects directory', async () => {
    const profileRoot = join(directory, '.claude', 'profile-a');
    await mkdir(join(profileRoot, 'projects'), { recursive: true });
    await writeFile(join(profileRoot, 'projects', '.keep'), '');

    await expect(
      catalog.list('claude', { cli: 'claude' }, { home: directory, processEnv: {} })
    ).resolves.toEqual([join(directory, '.claude'), profileRoot]);
  });
});

describe('withRuntimeStateRoot', () => {
  it('pins the provider process to the selected session root', () => {
    expect(
      withRuntimeStateRoot('codex', { cli: 'codex', env: { KEEP: 'yes' } }, '/state/account-a')
    ).toEqual({
      cli: 'codex',
      env: {
        KEEP: 'yes',
        CODEX_HOME: '/state/account-a',
      },
    });
  });
});
