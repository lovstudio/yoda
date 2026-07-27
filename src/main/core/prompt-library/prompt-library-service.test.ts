import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@main/db/schema';

const state = vi.hoisted(() => ({
  db: null as unknown,
  emit: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  get db() {
    return state.db;
  },
}));

vi.mock('@main/lib/events', () => ({
  events: { emit: state.emit },
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: {
    get: state.getSettings,
    update: state.updateSettings,
  },
}));

function createSchema(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE prompt_groups (
      name TEXT PRIMARY KEY NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    CREATE TABLE prompts (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '' NOT NULL,
      content TEXT NOT NULL,
      group_name TEXT DEFAULT '' NOT NULL,
      extra_info TEXT DEFAULT '' NOT NULL,
      injection_enabled INTEGER DEFAULT false NOT NULL,
      injection_order INTEGER DEFAULT 0 NOT NULL,
      source_json TEXT,
      sort_order INTEGER DEFAULT 0 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `);
}

describe('PromptLibraryService groups', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    vi.resetModules();
    state.emit.mockReset();
    state.getSettings.mockReset().mockResolvedValue({ items: [] });
    state.updateSettings.mockReset();
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    state.db = drizzle(sqlite, { schema });
  });

  afterEach(() => {
    sqlite.close();
    state.db = null;
  });

  it('persists an empty named group', async () => {
    const { PromptLibraryService } = await import('./prompt-library-service');
    const service = new PromptLibraryService();

    expect(await service.createGroup(' Research ')).toBe('Research');
    expect(await service.listGroups()).toEqual(['Research']);
  });

  it('persists groups introduced by prompt creation and movement', async () => {
    const { PromptLibraryService } = await import('./prompt-library-service');
    const service = new PromptLibraryService();
    const created = await service.create({
      title: 'Build',
      description: '',
      content: 'Build the project.',
      groupName: 'Development',
      extraInfo: '',
      injectionEnabled: false,
    });

    await service.update(created.id, { groupName: 'Review' });

    expect(await service.listGroups()).toEqual(['Development', 'Review']);
    expect(await service.list()).toEqual([
      expect.objectContaining({ id: created.id, groupName: 'Review' }),
    ]);
  });

  it('backfills groups from existing prompt rows during initialization', async () => {
    sqlite
      .prepare(
        `INSERT INTO prompts
          (id, title, content, group_name, created_at, updated_at)
         VALUES ('existing', 'Existing prompt', 'Content', 'Imported', ?, ?)`
      )
      .run('2026-07-27T00:00:00.000Z', '2026-07-27T00:00:00.000Z');
    const { PromptLibraryService } = await import('./prompt-library-service');
    const service = new PromptLibraryService();

    await service.initialize();

    expect(await service.listGroups()).toEqual(['Imported']);
  });
});
