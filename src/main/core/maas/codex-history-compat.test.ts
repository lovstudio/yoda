import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateLegacyCodexMaasHistory } from './codex-history-compat';

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
});
