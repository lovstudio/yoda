import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_REVIEW_TEAM_ID } from '@shared/agent-team';
import type { TeamParadigmParams } from '@shared/paradigms/params';
import * as schema from '@main/db/schema';

const state = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@main/db/client', () => ({
  get db() {
    return state.db;
  },
}));

async function loadService() {
  return (await import('./paradigms-service')).paradigmsService;
}

function insertTeam(
  sqlite: Database.Database,
  overrides: Partial<{
    id: string;
    name: string;
    icon: string;
    routing: string;
    routingHopLimit: number | null;
    communication: unknown;
    members: unknown;
    createdAt: string;
    updatedAt: string;
  }> = {}
) {
  const row = {
    id: 'team-1',
    name: 'Shipping crew',
    icon: '🚢',
    routing: 'sequential',
    routingHopLimit: 12,
    communication: { mode: 'shared-file', syncToRoom: false },
    members: [
      { handle: 'lead', displayName: 'Lead', role: 'leader', runtime: 'claude' },
      { handle: 'dev', displayName: 'Dev', role: 'worker', runtime: 'codex' },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-02T00:00:00.000Z',
    ...overrides,
  };
  sqlite
    .prepare(
      `INSERT INTO agent_teams
         (id, name, icon, routing, routing_hop_limit, communication, members, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      row.name,
      row.icon,
      row.routing,
      row.routingHopLimit,
      JSON.stringify(row.communication),
      JSON.stringify(row.members),
      row.createdAt,
      row.updatedAt
    );
  return row;
}

describe('paradigms service: folding agent_teams in', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    vi.resetModules();
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE paradigms (
        id TEXT PRIMARY KEY,
        kind_id TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        icon TEXT NOT NULL DEFAULT '',
        params TEXT NOT NULL DEFAULT '{}',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE agent_teams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT '',
        routing TEXT NOT NULL DEFAULT 'freeform',
        routing_hop_limit INTEGER DEFAULT 100,
        communication TEXT NOT NULL DEFAULT '{}',
        members TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    state.db = drizzle(sqlite, { schema });
  });

  it('carries a team across as a team-kind instance, id and wiring intact', async () => {
    const team = insertTeam(sqlite);
    const service = await loadService();

    const listed = await service.list();
    const migrated = listed.find((paradigm) => paradigm.id === team.id);

    expect(migrated).toBeDefined();
    expect(migrated?.kindId).toBe('team');
    // Rooms reference the team id, so re-keying would orphan every existing room.
    expect(migrated?.label).toBe(team.name);
    expect(migrated?.icon).toBe(team.icon);
    expect(migrated?.builtin).toBe(false);
    // Timestamps carry over so the picker does not reshuffle on upgrade.
    expect(migrated?.createdAt).toBe(team.createdAt);

    const params = migrated?.params as TeamParadigmParams;
    expect(params.routing).toBe('sequential');
    expect(params.routingHopLimit).toBe(12);
    expect(params.communication.mode).toBe('shared-file');
    expect(params.communication.syncToRoom).toBe(false);
    expect(params.members.map((member) => member.handle)).toEqual(['lead', 'dev']);
  });

  it('does not resurrect a team the user deleted after migrating', async () => {
    const team = insertTeam(sqlite);
    const service = await loadService();
    await service.list();
    await service.remove(team.id);

    // `agent_teams` is kept readable for a release as a fallback, so a re-run that
    // ignored the completion flag would bring the deleted team back.
    vi.resetModules();
    const reloaded = await loadService();
    const listed = await reloaded.list();

    expect(listed.some((paradigm) => paradigm.id === team.id)).toBe(false);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM agent_teams').get()).toEqual({ n: 1 });
  });

  it('repairs an unreadable member instead of migrating an empty roster', async () => {
    const team = insertTeam(sqlite, {
      routing: 'made-up',
      routingHopLimit: -4,
      members: [
        { handle: 'Lead', displayName: '', role: 'worker', runtime: 'retired-cli' },
        { handle: 'lead', displayName: 'Second', role: 'worker', runtime: 'codex' },
      ],
    });
    const service = await loadService();

    const migrated = (await service.list()).find((paradigm) => paradigm.id === team.id);
    const params = migrated?.params as TeamParadigmParams;

    expect(params.members).toHaveLength(2);
    expect(params.members[0].runtime).toBe('claude');
    expect(params.members[0].displayName).toBe('lead');
    expect(params.members.filter((member) => member.role === 'leader')).toHaveLength(1);
    expect(new Set(params.members.map((member) => member.handle)).size).toBe(2);
    expect(params.routing).toBe('freeform');
    expect(params.routingHopLimit).toBe(100);
  });

  it('leaves built-in teams to the code-defined list rather than writing rows', async () => {
    const service = await loadService();
    const listed = await service.list();

    expect(listed.some((paradigm) => paradigm.id === BUILTIN_REVIEW_TEAM_ID)).toBe(true);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM paradigms').get()).toEqual({ n: 0 });
  });

  it('overlays an edit onto a code-defined instance instead of copying it', async () => {
    const service = await loadService();
    const edit = (label: string, icon: string) =>
      service.update(BUILTIN_REVIEW_TEAM_ID, { kindId: 'team' as const, label, icon, params: {} });

    const updated = await edit('My reviewers', 'R');
    // The same instance, not a copy: rooms and composer drafts reference this id,
    // and a rename must not move the paradigm out from under them.
    expect(updated.id).toBe(BUILTIN_REVIEW_TEAM_ID);
    expect(updated.label).toBe('My reviewers');
    expect(updated.icon).toBe('R');
    // Still shipped — that is what keeps it undeletable — but now carrying edits.
    expect(updated.builtin).toBe(true);
    expect(updated.customized).toBe(true);

    const listed = await service.list();
    expect(listed.filter((paradigm) => paradigm.id === BUILTIN_REVIEW_TEAM_ID)).toHaveLength(1);
    expect(listed.find((paradigm) => paradigm.id === BUILTIN_REVIEW_TEAM_ID)?.label).toBe(
      'My reviewers'
    );

    // Editing again rewrites the one overlay row rather than conflicting on it.
    await edit('Again', '');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM paradigms').get()).toEqual({ n: 1 });

    await expect(service.remove(BUILTIN_REVIEW_TEAM_ID)).rejects.toThrow(/cannot be removed/);
  });

  it('refuses to change an instance to another kind, which its params are shaped by', async () => {
    const team = insertTeam(sqlite);
    const service = await loadService();
    await service.list();

    await expect(
      service.update(team.id, { kindId: 'single', label: 'Nope', icon: '', params: {} })
    ).rejects.toThrow(/kind cannot be changed/);
  });
});
