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
    expect(await service.listGroups()).toEqual([{ name: 'Research', parentName: null }]);
  });

  it('starts at v1.0.0 and creates immutable semantic versions for authored changes', async () => {
    const { PromptLibraryService } = await import('./prompt-library-service');
    const service = new PromptLibraryService();
    const created = await service.create({
      title: 'Review',
      content: 'Review this change.',
      description: '',
      groupName: '',
      extraInfo: '',
      injectionEnabled: false,
    });

    expect(created.version).toBe('1.0.0');
    expect(await service.listVersions(created.id)).toEqual([
      expect.objectContaining({ version: '1.0.0', content: 'Review this change.' }),
    ]);

    await service.update(created.id, { content: 'Review behavior and tests.' });
    await service.update(created.id, {
      description: 'Use before merging.',
      versionBump: 'minor',
    });
    await service.update(created.id, { injectionEnabled: true, groupName: 'Review' });

    expect((await service.list()).find((prompt) => prompt.id === created.id)?.version).toBe(
      '1.1.0'
    );
    expect((await service.listVersions(created.id)).map((version) => version.version)).toEqual([
      '1.1.0',
      '1.0.1',
      '1.0.0',
    ]);
  });

  it('restores an old snapshot as a new version without rewriting history', async () => {
    const { PromptLibraryService } = await import('./prompt-library-service');
    const service = new PromptLibraryService();
    const created = await service.create({
      title: 'Review',
      content: 'Original',
      description: '',
      groupName: '',
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

  it('renames a group while preserving its order and moving every prompt', async () => {
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
    await service.create({
      title: 'Review',
      description: '',
      content: 'Review',
      groupName: 'Review',
      extraInfo: '',
      injectionEnabled: true,
    });

    expect(await service.renameGroup(' Build ', ' Delivery ')).toBe('Delivery');

    expect(await service.listGroups()).toEqual([
      { name: 'Delivery', parentName: null },
      { name: 'Review', parentName: null },
    ]);
    expect(await service.list()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: build.id, groupName: 'Delivery' })])
    );
  });

  it('renames an empty group and rejects a duplicate name', async () => {
    const { PromptLibraryService } = await import('./prompt-library-service');
    const service = new PromptLibraryService();
    await service.createGroup('Research');
    await service.createGroup('Writing');

    expect(await service.renameGroup('Research', 'Discovery')).toBe('Discovery');
    await expect(service.renameGroup('Discovery', 'Writing')).rejects.toThrow(
      'Prompt group already exists'
    );
    expect(await service.listGroups()).toEqual([
      { name: 'Discovery', parentName: null },
      { name: 'Writing', parentName: null },
    ]);
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

    await service.reorderGroups(null, ['Review', 'Build']);

    expect(await service.listGroups()).toEqual([
      { name: 'Review', parentName: null },
      { name: 'Build', parentName: null },
    ]);
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

    expect(await service.listGroups()).toEqual([
      { name: 'Development', parentName: null },
      { name: 'Review', parentName: null },
    ]);
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

    expect(await service.listGroups()).toEqual([{ name: 'Imported', parentName: null }]);
  });

  it('creates nested groups, moves them, and rejects cycles', async () => {
    const { PromptLibraryService } = await import('./prompt-library-service');
    const service = new PromptLibraryService();
    await service.createGroup('Engineering');
    await service.createGroup('Frontend', 'Engineering');
    await service.createGroup('React', 'Frontend');

    expect(await service.listGroups()).toEqual([
      { name: 'Engineering', parentName: null },
      { name: 'Frontend', parentName: 'Engineering' },
      { name: 'React', parentName: 'Frontend' },
    ]);
    await service.renameGroup('Frontend', 'Web');
    expect(await service.listGroups()).toEqual([
      { name: 'Engineering', parentName: null },
      { name: 'Web', parentName: 'Engineering' },
      { name: 'React', parentName: 'Web' },
    ]);
    await expect(service.moveGroup('Engineering', 'React')).rejects.toThrow('cycle');

    await service.moveGroup('React', null);
    expect(await service.listGroups()).toEqual([
      { name: 'Engineering', parentName: null },
      { name: 'Web', parentName: 'Engineering' },
      { name: 'React', parentName: null },
    ]);
  });

  it('deletes a group, ungroups its prompts, and lifts direct children', async () => {
    const { PromptLibraryService } = await import('./prompt-library-service');
    const service = new PromptLibraryService();
    await service.createGroup('Engineering');
    await service.createGroup('Frontend', 'Engineering');
    const prompt = await service.create({
      title: 'Build',
      description: '',
      content: 'Build',
      groupName: 'Engineering',
      extraInfo: '',
      injectionEnabled: true,
    });

    await service.removeGroup('Engineering');

    expect(await service.listGroups()).toEqual([{ name: 'Frontend', parentName: null }]);
    expect(await service.list()).toEqual([
      expect.objectContaining({ id: prompt.id, groupName: '' }),
    ]);
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
