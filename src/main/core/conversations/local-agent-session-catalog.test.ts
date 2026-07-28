import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalAgentSessionCatalog } from './local-agent-session-catalog';

describe('LocalAgentSessionCatalog', () => {
  let directory: string;
  let codexRoot: string;
  let claudeRoot: string;
  let catalog: LocalAgentSessionCatalog;

  beforeEach(async () => {
    directory = join(process.cwd(), '.tmp-local-session-catalog', crypto.randomUUID());
    codexRoot = join(directory, 'codex-account');
    claudeRoot = join(directory, 'claude-account');
    await Promise.all([
      mkdir(codexRoot, { recursive: true }),
      mkdir(claudeRoot, { recursive: true }),
    ]);
    catalog = new LocalAgentSessionCatalog(
      {
        list: async (runtimeId) => [runtimeId === 'codex' ? codexRoot : claudeRoot],
      },
      async (runtimeId) => ({ cli: runtimeId })
    );
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('merges Codex and Claude sessions from every discovered account root', async () => {
    const projectPath = join(directory, 'project');
    const codexRollout = join(codexRoot, 'sessions', '2026', '01', '01', 'rollout-codex.jsonl');
    await mkdir(join(codexRoot, 'sessions', '2026', '01', '01'), { recursive: true });
    await writeFile(
      codexRollout,
      `${JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-01-01T00:00:00.000Z',
        payload: {
          id: 'codex-session',
          cwd: projectPath,
          model_provider: 'account-provider',
        },
      })}\n`
    );
    const database = new Database(join(codexRoot, 'state_5.sqlite'));
    database.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT NOT NULL,
        cwd TEXT NOT NULL,
        title TEXT NOT NULL,
        model_provider TEXT NOT NULL,
        archived INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        created_at_ms INTEGER,
        updated_at_ms INTEGER
      )
    `);
    database
      .prepare(
        `
          INSERT INTO threads (
            id, rollout_path, cwd, title, model_provider, archived,
            created_at, updated_at, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        'codex-session',
        codexRollout,
        projectPath,
        'Codex imported session',
        'account-provider',
        0,
        1,
        2,
        Date.parse('2026-01-01T00:00:00.000Z'),
        Date.parse('2026-01-02T00:00:00.000Z')
      );
    database.close();

    const claudeProject = join(claudeRoot, 'projects', '-project');
    const claudeTranscript = join(claudeProject, 'claude-session.jsonl');
    await mkdir(claudeProject, { recursive: true });
    await writeFile(
      claudeTranscript,
      [
        JSON.stringify({
          type: 'user',
          sessionId: 'claude-session',
          cwd: projectPath,
          timestamp: '2026-01-03T00:00:00.000Z',
          message: { content: 'Claude imported session' },
        }),
        JSON.stringify({
          type: 'assistant',
          sessionId: 'claude-session',
          cwd: projectPath,
          timestamp: '2026-01-03T00:01:00.000Z',
          message: { content: [{ type: 'text', text: 'Done' }] },
        }),
      ].join('\n')
    );

    const sessions = await catalog.list({ projectPath });

    expect(sessions).toHaveLength(2);
    expect(sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runtimeId: 'codex',
          sessionId: 'codex-session',
          stateRoot: codexRoot,
          providerId: 'account-provider',
          title: 'Codex imported session',
        }),
        expect.objectContaining({
          runtimeId: 'claude',
          sessionId: 'claude-session',
          stateRoot: claudeRoot,
          title: 'Claude imported session',
        }),
      ])
    );

    const claude = sessions.find((session) => session.runtimeId === 'claude');
    expect(claude).toBeDefined();
    await expect(catalog.getTranscript(claude!.catalogId)).resolves.toMatchObject({
      filePath: claudeTranscript,
      totalLines: 2,
    });
    await expect(catalog.validateSource(claude!)).resolves.toMatchObject({
      sessionId: 'claude-session',
    });
  });

  it('filters sessions outside the selected project', async () => {
    const transcript = join(claudeRoot, 'projects', '-other', 'other.jsonl');
    await mkdir(join(claudeRoot, 'projects', '-other'), { recursive: true });
    await writeFile(
      transcript,
      JSON.stringify({
        type: 'user',
        sessionId: 'other',
        cwd: join(directory, 'other-project'),
        timestamp: '2026-01-01T00:00:00.000Z',
        message: { content: 'Other' },
      })
    );

    await expect(catalog.list({ projectPath: join(directory, 'project') })).resolves.toEqual([]);
  });

  it('discovers archived Codex rollouts even when the account has no thread index', async () => {
    const projectPath = join(directory, 'project');
    const transcript = join(codexRoot, 'archived_sessions', 'rollout-archived.jsonl');
    await mkdir(join(codexRoot, 'archived_sessions'), { recursive: true });
    await writeFile(
      transcript,
      [
        JSON.stringify({
          type: 'session_meta',
          timestamp: '2026-01-01T00:00:00.000Z',
          payload: { id: 'archived-session', cwd: projectPath, model_provider: 'provider-a' },
        }),
        JSON.stringify({
          type: 'event_msg',
          payload: { type: 'user_message', message: 'Archived prompt' },
        }),
      ].join('\n')
    );

    await expect(catalog.list({ projectPath })).resolves.toEqual([
      expect.objectContaining({
        sessionId: 'archived-session',
        title: 'Archived prompt',
        archived: true,
      }),
    ]);
  });
});
