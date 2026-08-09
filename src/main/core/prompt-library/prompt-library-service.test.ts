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
      parent_name TEXT,
      sort_order INTEGER DEFAULT 0 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    CREATE TABLE prompts (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '' NOT NULL,
      content TEXT NOT NULL,
      group_name TEXT DEFAULT '' NOT NULL,
      tags_json TEXT DEFAULT '[]' NOT NULL,
      extra_info TEXT DEFAULT '' NOT NULL,
      injection_enabled INTEGER DEFAULT false NOT NULL,
      injection_order INTEGER DEFAULT 0 NOT NULL,
      version TEXT DEFAULT '1.0.0' NOT NULL,
      source_json TEXT,
      sort_order INTEGER DEFAULT 0 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    CREATE TABLE prompt_versions (
      id TEXT PRIMARY KEY NOT NULL,
      prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
      version TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '' NOT NULL,
      content TEXT NOT NULL,
      extra_info TEXT DEFAULT '' NOT NULL,
      source_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    CREATE UNIQUE INDEX idx_prompt_versions_prompt_id_version
      ON prompt_versions(prompt_id, version);
  `);
}

describe('PromptLibraryService flat prompt model', () => {
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

  it('creates a prompt with normalized human-only tags and a version snapshot', async () => {
    const { PromptLibraryService } = await import('./prompt-library-service');
    const service = new PromptLibraryService();

    const created = await service.create({
      title: 'Review',
      content: 'Review this change.',
      tags: [' Review ', 'Writing', 'Review'],
      description: '',
      extraInfo: '',
      injectionEnabled: false,
    });

    expect(created.tags).toEqual(['Review', 'Writing']);
    expect(await service.listVersions(created.id)).toEqual([
      expect.objectContaining({ version: '1.0.0', content: 'Review this change.' }),
    ]);
  });

  it('updates tags without creating a content version', async () => {
    const { PromptLibraryService } = await import('./prompt-library-service');
    const service = new PromptLibraryService();
    const created = await service.create({
      title: 'Review',
      content: 'Original',
      tags: ['Review'],
      description: '',
      extraInfo: '',
      injectionEnabled: false,
    });

    await service.update(created.id, { tags: ['Writing'], injectionEnabled: true });

    expect(await service.list()).toEqual([
      expect.objectContaining({ id: created.id, tags: ['Writing'], injectionEnabled: true }),
    ]);
    expect((await service.listVersions(created.id)).map((version) => version.version)).toEqual([
      '1.0.0',
    ]);
  });

  it('reorders every prompt in one flat list and derives injection order from it', async () => {
    const { PromptLibraryService } = await import('./prompt-library-service');
    const service = new PromptLibraryService();
    const first = await service.create({
      title: 'First',
      content: 'First',
      description: '',
      tags: [],
      extraInfo: '',
      injectionEnabled: false,
    });
    const second = await service.create({
      title: 'Second',
      content: 'Second',
      description: '',
      tags: [],
      extraInfo: '',
      injectionEnabled: false,
    });
    const third = await service.create({
      title: 'Third',
      content: 'Third',
      description: '',
      tags: [],
      extraInfo: '',
      injectionEnabled: false,
    });

    await service.reorderPrompts([first.id, third.id, second.id]);

    const ordered = await service.list();
    expect(ordered.map((prompt) => prompt.id)).toEqual([first.id, third.id, second.id]);
    expect(ordered.map((prompt) => prompt.injectionOrder)).toEqual([0, 1, 2]);
  });

  it('toggles every prompt carrying a tag in one operation', async () => {
    const { PromptLibraryService } = await import('./prompt-library-service');
    const service = new PromptLibraryService();
    const review = await service.create({
      title: 'Review',
      content: 'Review',
      description: '',
      tags: ['Review'],
      extraInfo: '',
      injectionEnabled: false,
    });
    const writing = await service.create({
      title: 'Writing',
      content: 'Writing',
      description: '',
      tags: ['Writing'],
      extraInfo: '',
      injectionEnabled: false,
    });
    const shared = await service.create({
      title: 'Shared',
      content: 'Shared',
      description: '',
      tags: ['Review', 'Writing'],
      extraInfo: '',
      injectionEnabled: false,
    });

    await service.setTagInjectionEnabled(' Review ', true);

    expect((await service.list()).map((prompt) => [prompt.id, prompt.injectionEnabled])).toEqual([
      [shared.id, true],
      [writing.id, false],
      [review.id, true],
    ]);
  });

  it('converts legacy nested groups into tags during initialization and clears the old relation', async () => {
    sqlite
      .prepare(
        `INSERT INTO prompt_groups (name, parent_name, sort_order) VALUES
          ('Engineering', NULL, 0),
          ('Frontend', 'Engineering', 0),
          ('React', 'Frontend', 0)`
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO prompts
          (id, title, content, group_name, tags_json, sort_order, created_at, updated_at)
         VALUES ('existing', 'Existing prompt', 'Content', 'React', '["Useful"]', 0, ?, ?)`
      )
      .run('2026-07-27T00:00:00.000Z', '2026-07-27T00:00:00.000Z');
    const { PromptLibraryService } = await import('./prompt-library-service');
    const service = new PromptLibraryService();

    await service.initialize();

    expect(await service.list()).toEqual([
      expect.objectContaining({
        id: 'existing',
        tags: ['Useful', 'Engineering', 'Frontend', 'React'],
      }),
    ]);
    expect(sqlite.prepare('SELECT group_name FROM prompts WHERE id = ?').get('existing')).toEqual({
      group_name: '',
    });
  });

  it('restores an old snapshot as a new semantic version without rewriting history', async () => {
    const { PromptLibraryService } = await import('./prompt-library-service');
    const service = new PromptLibraryService();
    const created = await service.create({
      title: 'Review',
      content: 'Original',
      description: '',
      tags: [],
      extraInfo: '',
      injectionEnabled: false,
    });
    await service.update(created.id, { content: 'Changed' });

    const restored = await service.restoreVersion(created.id, '1.0.0');

    expect(restored).toMatchObject({ content: 'Original', version: '1.0.2' });
    expect((await service.listVersions(created.id)).map((version) => version.version)).toEqual([
      '1.0.2',
      '1.0.1',
      '1.0.0',
    ]);
  });
});
