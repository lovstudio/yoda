import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCodexSessionContext } from './getCodexSessionContext';

describe('getCodexSessionContext', () => {
  const previousCodexHome = process.env.CODEX_HOME;
  let dir: string;
  let cwd: string;
  let codexHome: string;
  let statePath: string;
  let rolloutPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'yoda-codex-context-'));
    cwd = join(dir, 'repo');
    codexHome = join(dir, 'codex-home');
    statePath = join(codexHome, 'state_5.sqlite');
    rolloutPath = join(dir, 'rollout.jsonl');
    mkdirSync(cwd, { recursive: true });
    mkdirSync(codexHome, { recursive: true });
    process.env.CODEX_HOME = codexHome;
    createStateDb(statePath);
  });

  afterEach(() => {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('aggregates Codex thread metadata, rollout prompts, tools, memory, and skills', async () => {
    writeFileSync(join(cwd, 'AGENTS.md'), 'Project instructions');
    mkdirSync(join(cwd, '.codex', 'skills', 'local-skill'), { recursive: true });
    writeFileSync(
      join(cwd, '.codex', 'skills', 'local-skill', 'SKILL.md'),
      '---\ndescription: Local skill description\n---\n'
    );
    writeRollout(rolloutPath);
    insertThread(statePath, rolloutPath, {
      id: 'conversation-1',
      cwd,
      title: 'Thread title',
      firstUserMessage: 'Fallback prompt',
    });
    insertDynamicTool(statePath, 'conversation-1');

    const context = await getCodexSessionContext(cwd, 'conversation-1');

    expect(context).toEqual(
      expect.objectContaining({
        threadId: 'conversation-1',
        title: 'Thread title',
        model: 'gpt-5.5',
        modelProvider: 'openai',
        cliVersion: '0.136.0',
        approvalMode: 'on-request',
        sandboxPolicy: 'workspace-write',
        baseInstructions: 'Base instructions',
      })
    );
    expect(context?.prompts).toEqual([
      {
        id: '2026-06-02T11:00:03.000Z',
        text: 'Implement Codex context',
        timestamp: '2026-06-02T11:00:03.000Z',
      },
    ]);
    expect(context?.messages).toEqual([
      {
        id: '2026-06-02T11:00:03.000Z',
        role: 'user',
        text: 'Implement Codex context',
        timestamp: '2026-06-02T11:00:03.000Z',
      },
      {
        id: '2026-06-02T11:00:04.000Z',
        role: 'assistant',
        text: 'Done',
        timestamp: '2026-06-02T11:00:04.000Z',
      },
    ]);
    expect(context?.developerMessages[0]?.text).toBe('Developer instructions');
    expect(context?.turnContexts[0]).toEqual(
      expect.objectContaining({
        turnId: 'turn-1',
        model: 'gpt-5.5',
        approvalPolicy: 'on-request',
        sandboxPolicy: 'workspace-write',
        effort: 'xhigh',
      })
    );
    expect(context?.completedTurnCount).toBe(1);
    expect(context?.dynamicTools).toEqual([
      {
        name: 'tool_one',
        namespace: 'mcp_server',
        description: 'Tool description',
        inputSchema: '{"type":"object"}',
        deferLoading: true,
      },
    ]);
    expect(context?.memoryFiles.some((file) => file.path.endsWith('AGENTS.md'))).toBe(true);
    expect(context?.skillsListing).toContain('- local-skill: Local skill description');
  });

  it('can resolve a Codex thread by conversation title when the ids differ', async () => {
    writeRollout(rolloutPath);
    insertThread(statePath, rolloutPath, {
      id: 'thread-1',
      cwd,
      title: 'Matching title',
      firstUserMessage: 'Fallback prompt',
    });

    const context = await getCodexSessionContext(cwd, 'conversation-1', 'Matching title');

    expect(context?.threadId).toBe('thread-1');
  });

  it('can resolve a Codex thread by created_at when the Yoda title is truncated', async () => {
    writeRollout(rolloutPath, { id: 'thread-1', cwd });
    insertThread(statePath, rolloutPath, {
      id: 'thread-1',
      cwd,
      title: '@src/renderer/features/tasks/context-panel.tsx:91:5 context pane should be compact',
      firstUserMessage:
        '@src/renderer/features/tasks/context-panel.tsx:91:5 context pane should be compact',
      createdAtMs: Date.parse('2026-06-02T11:00:00.000Z'),
    });

    const context = await getCodexSessionContext(
      cwd,
      'yoda-conversation-id',
      '@src/renderer/features/tasks/context-panel.tsx:91:5 context pane',
      '2026-06-02 11:00:00'
    );

    expect(context?.threadId).toBe('thread-1');
    expect(context?.rolloutPath).toBe(rolloutPath);
  });

  it('can resolve a delayed untitled Codex thread when it is the only later cwd match', async () => {
    writeRollout(rolloutPath, { id: 'delayed-thread', cwd });
    insertThread(statePath, rolloutPath, {
      id: 'delayed-thread',
      cwd,
      title: '',
      firstUserMessage: '',
      createdAtMs: Date.parse('2026-06-02T11:21:00.000Z'),
    });

    const context = await getCodexSessionContext(
      cwd,
      'yoda-conversation-id',
      'Yoda conversation title',
      '2026-06-02 11:00:00'
    );

    expect(context?.threadId).toBe('delayed-thread');
    expect(context?.rolloutPath).toBe(rolloutPath);
  });

  it('can resolve a moved-path Codex thread by title prefix and created_at', async () => {
    const oldCwd = join(dir, 'old-repo');
    writeRollout(rolloutPath, { id: 'thread-1', cwd: oldCwd });
    insertThread(statePath, rolloutPath, {
      id: 'thread-1',
      cwd: oldCwd,
      title: 'Build a search service for a long ebook prompt',
      firstUserMessage: 'Build a search service for a long ebook prompt',
      createdAtMs: Date.parse('2026-06-02T11:00:00.000Z'),
    });

    const context = await getCodexSessionContext(
      cwd,
      'yoda-conversation-id',
      'Build a search service',
      '2026-06-02 11:00:00'
    );

    expect(context?.threadId).toBe('thread-1');
    expect(context?.cwd).toBe(oldCwd);
    expect(context?.rolloutPath).toBe(rolloutPath);
  });

  it('can resolve a moved-path rollout when the state DB has no matching thread', async () => {
    const oldCwd = join(dir, 'old-repo');
    const sessionDir = join(codexHome, 'sessions', '2026', '06', '02');
    const sessionRolloutPath = join(sessionDir, 'rollout-2026-06-02T11-00-00-thread-1.jsonl');
    mkdirSync(sessionDir, { recursive: true });
    writeRollout(sessionRolloutPath, { cwd: oldCwd, id: 'thread-1' });

    const context = await getCodexSessionContext(
      cwd,
      'yoda-conversation-id',
      'Implement Codex con',
      '2026-06-02 11:00:00'
    );

    expect(context?.threadId).toBe('thread-1');
    expect(context?.cwd).toBe(oldCwd);
    expect(context?.rolloutPath).toBe(sessionRolloutPath);
  });

  it('falls back to rollout files when the state DB has no matching thread', async () => {
    const sessionDir = join(codexHome, 'sessions', '2026', '06', '02');
    const sessionRolloutPath = join(sessionDir, 'rollout-2026-06-02T11-00-00-conversation-1.jsonl');
    mkdirSync(sessionDir, { recursive: true });
    writeRollout(sessionRolloutPath, { cwd });

    const context = await getCodexSessionContext(cwd, 'conversation-1');

    expect(context).toEqual(
      expect.objectContaining({
        threadId: 'conversation-1',
        rolloutPath: sessionRolloutPath,
        title: 'Implement Codex context',
        model: 'gpt-5.5',
        modelProvider: 'openai',
        cliVersion: '0.136.0',
        approvalMode: 'on-request',
        sandboxPolicy: 'workspace-write',
        baseInstructions: 'Base instructions',
      })
    );
    expect(context?.prompts[0]?.text).toBe('Implement Codex context');
  });

  it('does not fall back to an unrelated latest rollout for the same cwd', async () => {
    const sessionDir = join(codexHome, 'sessions', '2026', '06', '02');
    const sessionRolloutPath = join(sessionDir, 'rollout-2026-06-02T11-00-00-thread-1.jsonl');
    mkdirSync(sessionDir, { recursive: true });
    writeRollout(sessionRolloutPath, { cwd, id: 'thread-1' });

    const context = await getCodexSessionContext(cwd, 'missing-conversation', 'Missing title');

    expect(context).toBeNull();
  });
});

function createStateDb(statePath: string): void {
  const db = new Database(statePath);
  try {
    db.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        cwd TEXT NOT NULL,
        rollout_path TEXT NOT NULL,
        title TEXT NOT NULL,
        model TEXT,
        model_provider TEXT NOT NULL,
        cli_version TEXT NOT NULL,
        memory_mode TEXT NOT NULL,
        approval_mode TEXT NOT NULL,
        sandbox_policy TEXT NOT NULL,
        first_user_message TEXT NOT NULL,
        preview TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        created_at_ms INTEGER,
        updated_at INTEGER NOT NULL,
        updated_at_ms INTEGER
      );
      CREATE TABLE thread_dynamic_tools (
        thread_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        name TEXT NOT NULL,
        namespace TEXT,
        description TEXT NOT NULL,
        input_schema TEXT NOT NULL,
        defer_loading INTEGER NOT NULL DEFAULT 0
      );
    `);
  } finally {
    db.close();
  }
}

function insertThread(
  statePath: string,
  rolloutPath: string,
  args: {
    id: string;
    cwd: string;
    title: string;
    firstUserMessage: string;
    createdAtMs?: number;
  }
): void {
  const db = new Database(statePath);
  const createdAtMs = args.createdAtMs ?? 1000;
  try {
    db.prepare(
      `
        INSERT INTO threads (
          id,
          cwd,
          rollout_path,
          title,
          model,
          model_provider,
          cli_version,
          memory_mode,
          approval_mode,
          sandbox_policy,
          first_user_message,
          preview,
          archived,
          created_at,
          created_at_ms,
          updated_at,
          updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
      `
    ).run(
      args.id,
      args.cwd,
      rolloutPath,
      args.title,
      'gpt-5.5',
      'openai',
      '0.135.0',
      'enabled',
      'on-request',
      'workspace-write',
      args.firstUserMessage,
      args.firstUserMessage,
      Math.floor(createdAtMs / 1000),
      createdAtMs,
      Math.floor(createdAtMs / 1000),
      createdAtMs
    );
  } finally {
    db.close();
  }
}

function insertDynamicTool(statePath: string, threadId: string): void {
  const db = new Database(statePath);
  try {
    db.prepare(
      `
        INSERT INTO thread_dynamic_tools (
          thread_id,
          position,
          name,
          namespace,
          description,
          input_schema,
          defer_loading
        ) VALUES (?, 0, 'tool_one', 'mcp_server', 'Tool description', '{"type":"object"}', 1)
      `
    ).run(threadId);
  } finally {
    db.close();
  }
}

function writeRollout(path: string, args?: { cwd?: string; id?: string }): void {
  const rows = [
    {
      timestamp: '2026-06-02T11:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: args?.id ?? 'conversation-1',
        cwd: args?.cwd ?? '/repo',
        cli_version: '0.136.0',
        model_provider: 'openai',
        base_instructions: { text: 'Base instructions' },
      },
    },
    {
      timestamp: '2026-06-02T11:00:01.000Z',
      type: 'turn_context',
      payload: {
        turn_id: 'turn-1',
        model: 'gpt-5.5',
        approval_policy: 'on-request',
        sandbox_policy: 'workspace-write',
        effort: 'xhigh',
      },
    },
    {
      timestamp: '2026-06-02T11:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'developer',
        content: [{ type: 'input_text', text: 'Developer instructions' }],
      },
    },
    {
      timestamp: '2026-06-02T11:00:03.000Z',
      type: 'event_msg',
      payload: {
        type: 'user_message',
        message: 'Implement Codex context',
        images: [],
        local_images: [],
        text_elements: [],
      },
    },
    {
      timestamp: '2026-06-02T11:00:04.000Z',
      type: 'event_msg',
      payload: {
        type: 'task_complete',
        turn_id: 'turn-1',
        last_agent_message: 'Done',
      },
    },
  ];
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join('\n'));
}
