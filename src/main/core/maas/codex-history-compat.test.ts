import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureCodexResumeProviderCompatible,
  migrateLegacyCodexMaasHistory,
} from './codex-history-compat';

describe('legacy Codex MaaS history compatibility', () => {
  let directory: string;
  let statePath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'yoda-codex-maas-history-'));
    statePath = join(directory, 'state_5.sqlite');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('retags legacy yoda-maas threads as openai in SQLite and rollout metadata', () => {
    const legacyRolloutPath = join(directory, 'legacy.jsonl');
    const nativeRolloutPath = join(directory, 'native.jsonl');
    const firstMeta = {
      timestamp: '2026-07-25T00:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: 'legacy-thread',
        cwd: '/workspace',
        model_provider: 'yoda-maas',
        originator: 'codex_cli_rs',
      },
    };
    const latestMeta = {
      ...firstMeta,
      timestamp: '2026-07-25T00:01:00.000Z',
      payload: { ...firstMeta.payload, git: { branch: 'feature/keep-me' } },
    };
    writeFileSync(
      legacyRolloutPath,
      `${JSON.stringify(firstMeta)}\n${JSON.stringify({ type: 'event_msg', payload: {} })}\n${JSON.stringify(latestMeta)}\n`
    );
    const nativeContents = `${JSON.stringify({
      ...firstMeta,
      payload: { ...firstMeta.payload, id: 'native-thread', model_provider: 'openai' },
    })}\n`;
    writeFileSync(nativeRolloutPath, nativeContents);

    const db = new Database(statePath);
    db.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT NOT NULL,
        model_provider TEXT NOT NULL
      )
    `);
    db.prepare('INSERT INTO threads VALUES (?, ?, ?)').run(
      'legacy-thread',
      legacyRolloutPath,
      'yoda-maas'
    );
    db.prepare('INSERT INTO threads VALUES (?, ?, ?)').run(
      'native-thread',
      nativeRolloutPath,
      'openai'
    );
    db.close();

    expect(migrateLegacyCodexMaasHistory({ statePath })).toEqual({ rows: 1, files: 1 });

    const migratedDb = new Database(statePath, { readonly: true });
    expect(
      migratedDb.prepare('SELECT model_provider FROM threads WHERE id = ?').get('legacy-thread')
    ).toEqual({ model_provider: 'openai' });
    migratedDb.close();

    const records = readFileSync(legacyRolloutPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; payload: Record<string, unknown> });
    expect(records).toHaveLength(3);
    expect(records[0]?.payload.model_provider).toBe('openai');
    expect(records.at(-1)?.payload).toMatchObject({
      id: 'legacy-thread',
      model_provider: 'openai',
      git: { branch: 'feature/keep-me' },
    });
    expect(readFileSync(nativeRolloutPath, 'utf8')).toBe(nativeContents);

    const onceMigrated = readFileSync(legacyRolloutPath, 'utf8');
    expect(migrateLegacyCodexMaasHistory({ statePath })).toEqual({ rows: 0, files: 0 });
    expect(readFileSync(legacyRolloutPath, 'utf8')).toBe(onceMigrated);
  });

  it('is a no-op when Codex has not created a state database', () => {
    expect(migrateLegacyCodexMaasHistory({ statePath })).toEqual({ rows: 0, files: 0 });
  });

  it('retags the requested thread when its historical provider is no longer configured', () => {
    const rolloutPath = join(directory, 'stale-provider.jsonl');
    const configPath = join(directory, 'config.toml');
    const firstMeta = {
      timestamp: '2026-07-25T00:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: 'stale-thread',
        cwd: '/workspace',
        model_provider: 'lovbrowser',
        originator: 'codex-tui',
      },
    };
    writeFileSync(
      rolloutPath,
      `${JSON.stringify(firstMeta)}\n${JSON.stringify({ type: 'event_msg', payload: {} })}\n`
    );
    writeFileSync(configPath, 'model = "gpt-5.6-codex"\n');

    const db = new Database(statePath);
    db.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT NOT NULL,
        model_provider TEXT NOT NULL
      )
    `);
    db.prepare('INSERT INTO threads VALUES (?, ?, ?)').run(
      'stale-thread',
      rolloutPath,
      'lovbrowser'
    );
    db.close();

    expect(
      ensureCodexResumeProviderCompatible({
        threadId: 'stale-thread',
        statePath,
        configPath,
      })
    ).toEqual({
      status: 'repaired',
      fromProviderId: 'lovbrowser',
      toProviderId: 'openai',
    });

    const repairedDb = new Database(statePath, { readonly: true });
    expect(
      repairedDb.prepare('SELECT model_provider FROM threads WHERE id = ?').get('stale-thread')
    ).toEqual({ model_provider: 'openai' });
    repairedDb.close();

    const records = readFileSync(rolloutPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; payload: Record<string, unknown> });
    expect(records).toHaveLength(2);
    expect(records[0]?.payload.model_provider).toBe('openai');
    expect(records.at(-1)?.type).toBe('event_msg');
  });

  it('preserves a historical provider that is still present in Codex config', () => {
    const rolloutPath = join(directory, 'configured-provider.jsonl');
    const configPath = join(directory, 'config.toml');
    const contents = `${JSON.stringify({
      timestamp: '2026-07-25T00:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: 'configured-thread',
        cwd: '/workspace',
        model_provider: 'lovbrowser',
      },
    })}\n`;
    writeFileSync(rolloutPath, contents);
    writeFileSync(
      configPath,
      [
        'model_provider = "custom"',
        '[model_providers.lovbrowser]',
        'name = "LovBrowser"',
        'base_url = "https://example.test/v1"',
        'wire_api = "responses"',
        '',
        '[model_providers.custom]',
        'name = "Custom"',
        'base_url = "https://custom.example.test/v1"',
        'wire_api = "responses"',
        '',
      ].join('\n')
    );

    const db = new Database(statePath);
    db.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT NOT NULL,
        model_provider TEXT NOT NULL
      )
    `);
    db.prepare('INSERT INTO threads VALUES (?, ?, ?)').run(
      'configured-thread',
      rolloutPath,
      'lovbrowser'
    );
    db.close();

    expect(
      ensureCodexResumeProviderCompatible({
        threadId: 'configured-thread',
        statePath,
        configPath,
      })
    ).toEqual({ status: 'unchanged', providerId: 'lovbrowser' });
    expect(readFileSync(rolloutPath, 'utf8')).toBe(contents);
  });
});
