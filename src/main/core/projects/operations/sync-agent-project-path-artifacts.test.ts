import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeClaudeProjectDir } from '@main/core/session-title/claude-title-source';
import {
  syncClaudeProjectArtifacts,
  syncCodexProjectArtifacts,
} from './sync-agent-project-path-artifacts';

describe('sync agent project path artifacts', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoda-agent-artifacts-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('renames the Claude project archive directory when the target does not exist', async () => {
    const claudeProjectsDir = path.join(dir, 'claude-projects');
    const oldDir = path.join(claudeProjectsDir, encodeClaudeProjectDir('/old/repo'));
    const newDir = path.join(claudeProjectsDir, encodeClaudeProjectDir('/new/repo'));
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'session.jsonl'), '{}\n');

    const result = await syncClaudeProjectArtifacts('/old/repo', '/new/repo', claudeProjectsDir);

    expect(result.status).toBe('renamed');
    expect(fs.existsSync(oldDir)).toBe(false);
    expect(fs.readFileSync(path.join(newDir, 'session.jsonl'), 'utf8')).toBe('{}\n');
  });

  it('merges Claude project archives without overwriting existing target files', async () => {
    const claudeProjectsDir = path.join(dir, 'claude-projects');
    const oldDir = path.join(claudeProjectsDir, encodeClaudeProjectDir('/old/repo'));
    const newDir = path.join(claudeProjectsDir, encodeClaudeProjectDir('/new/repo'));
    fs.mkdirSync(path.join(oldDir, 'memory'), { recursive: true });
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'old.jsonl'), 'old');
    fs.writeFileSync(path.join(oldDir, 'conflict.jsonl'), 'old conflict');
    fs.writeFileSync(path.join(oldDir, 'memory', 'note.md'), 'memory');
    fs.writeFileSync(path.join(newDir, 'conflict.jsonl'), 'new conflict');

    const result = await syncClaudeProjectArtifacts('/old/repo', '/new/repo', claudeProjectsDir);

    expect(result.status).toBe('merged');
    expect(result.movedEntries).toBe(2);
    expect(result.skippedEntries).toBe(1);
    expect(fs.readFileSync(path.join(newDir, 'old.jsonl'), 'utf8')).toBe('old');
    expect(fs.readFileSync(path.join(newDir, 'memory', 'note.md'), 'utf8')).toBe('memory');
    expect(fs.readFileSync(path.join(newDir, 'conflict.jsonl'), 'utf8')).toBe('new conflict');
    expect(fs.readFileSync(path.join(oldDir, 'conflict.jsonl'), 'utf8')).toBe('old conflict');
  });

  it('updates Codex thread cwd rows for the moved project path', () => {
    const statePath = path.join(dir, 'state_5.sqlite');
    const db = new Database(statePath);
    try {
      db.exec(`
        CREATE TABLE threads (
          id TEXT PRIMARY KEY,
          cwd TEXT NOT NULL
        );
        INSERT INTO threads (id, cwd) VALUES
          ('one', '/old/repo'),
          ('two', '/old/repo'),
          ('child', '/old/repo/.git'),
          ('sibling', '/old/repository'),
          ('other', '/other/repo');
      `);
    } finally {
      db.close();
    }

    const result = syncCodexProjectArtifacts('/old/repo', '/new/repo', statePath);

    expect(result.updatedThreads).toBe(3);
    const verifyDb = new Database(statePath, { readonly: true });
    try {
      const rows = verifyDb.prepare('SELECT id, cwd FROM threads ORDER BY id').all();
      expect(rows).toEqual([
        { id: 'child', cwd: '/new/repo/.git' },
        { id: 'one', cwd: '/new/repo' },
        { id: 'other', cwd: '/other/repo' },
        { id: 'sibling', cwd: '/old/repository' },
        { id: 'two', cwd: '/new/repo' },
      ]);
    } finally {
      verifyDb.close();
    }
  });
});
