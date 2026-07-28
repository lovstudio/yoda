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
      sort_order INTEGER DEFAULT 0 NOT NULL,
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

  it('reorders named groups and keeps ungrouped prompts after them', async () => {
    const { PromptLibraryService } = await import('./prompt-library-service');
    const service = new PromptLibraryService();
    const build = await service.create({
      title: 'Build',
      description: '',
      content: 'Build',
      groupName: 'Build',
      extraInfo: '',
      injectionEnabled: true,
    });
    const review = await service.create({
      title: 'Review',
      description: '',
      content: 'Review',
      groupName: 'Review',
      extraInfo: '',
      injectionEnabled: true,
    });
    const ungrouped = await service.create({
      title: 'General',
      description: '',
      content: 'General',
      groupName: '',
      extraInfo: '',
      injectionEnabled: true,
    });

    await service.reorderGroups(['Review', 'Build']);

    expect(await service.listGroups()).toEqual(['Review', 'Build']);
    expect(
      (await service.list())
        .slice()
        .sort((left, right) => left.injectionOrder - right.injectionOrder)
        .map((prompt) => prompt.id)
    ).toEqual([review.id, build.id, ungrouped.id]);
  });

  it('reorders prompts only inside the selected group and syncs injection order', async () => {
    const { PromptLibraryService } = await import('./prompt-library-service');
    const service = new PromptLibraryService();
    const first = await service.create({
      title: 'First',
      description: '',
      content: 'First',
      groupName: 'Review',
      extraInfo: '',
      injectionEnabled: true,
    });
    const second = await service.create({
      title: 'Second',
      description: '',
      content: 'Second',
      groupName: 'Review',
      extraInfo: '',
      injectionEnabled: true,
    });

    await service.reorderPrompts('Review', [first.id, second.id]);

    const ordered = await service.list();
    expect(ordered.map((prompt) => prompt.id)).toEqual([first.id, second.id]);
    expect(ordered.map((prompt) => prompt.injectionOrder)).toEqual([0, 1]);
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

  it('toggles a whole group without changing the visible prompt order', async () => {
    const { PromptLibraryService } = await import('./prompt-library-service');
    const service = new PromptLibraryService();
    const biography = await service.create({
      title: 'Biography',
      description: '',
      content: 'Biography',
      groupName: 'Brand',
      extraInfo: '',
      injectionEnabled: true,
    });
    const assets = await service.create({
      title: 'Assets',
      description: '',
      content: 'Assets',
      groupName: 'Brand',
      extraInfo: '',
      injectionEnabled: false,
    });
    const language = await service.create({
      title: 'Language',
      description: '',
      content: 'Language',
      groupName: 'General',
      extraInfo: '',
      injectionEnabled: true,
    });
    state.emit.mockReset();

    await service.setGroupInjectionEnabled(' Brand ', true);

    const enabled = (await service.list()).filter((prompt) => prompt.injectionEnabled);
    expect(enabled.map((prompt) => prompt.id)).toEqual(
      expect.arrayContaining([biography.id, assets.id, language.id])
    );
    expect(
      enabled
        .slice()
        .sort((left, right) => left.injectionOrder - right.injectionOrder)
        .map((prompt) => prompt.id)
    ).toEqual([assets.id, biography.id, language.id]);
    expect(state.emit).toHaveBeenCalledTimes(1);

    state.emit.mockReset();
    await service.setGroupInjectionEnabled('Brand', false);
    expect(
      (await service.list())
        .filter((prompt) => prompt.groupName === 'Brand')
        .every((prompt) => !prompt.injectionEnabled)
    ).toBe(true);
    expect(state.emit).toHaveBeenCalledTimes(1);
  });
});
