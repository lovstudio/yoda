import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogIndex, CatalogSkill } from '@shared/skills/types';
import { SkillsService } from './SkillsService';

const temporaryDirectories: string[] = [];

function installedSkill(id: string, localPath: string): CatalogSkill {
  const key = `skill:local:${id}:${localPath}`;
  return {
    key,
    ref: { key, id, source: 'local', locator: localPath },
    id,
    displayName: id,
    description: '',
    source: 'local',
    scope: 'user',
    managed: false,
    frontmatter: { name: id, description: '' },
    installed: true,
    disabled: false,
    localPath,
  };
}

async function createFixture(ids: string[]) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'yoda-skill-batch-'));
  temporaryDirectories.push(root);
  const skills: CatalogSkill[] = [];
  for (const id of ids) {
    const localPath = path.join(root, id);
    await fs.promises.mkdir(localPath);
    await fs.promises.writeFile(path.join(localPath, 'SKILL.md'), `# ${id}\n`);
    skills.push(installedSkill(id, localPath));
  }
  return { root, skills };
}

function catalog(skills: CatalogSkill[]): CatalogIndex {
  return { version: 4, lastUpdated: new Date(0).toISOString(), skills };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.promises.rm(directory, { recursive: true, force: true }))
  );
});

describe('SkillsService.setSkillsDisabled', () => {
  it('uses one catalog snapshot and updates every requested skill in one batch', async () => {
    const fixture = await createFixture(['lovstudio-alpha', 'lovstudio-beta']);
    const service = new SkillsService();
    vi.spyOn(service, 'initialize').mockResolvedValue();
    const getCatalog = vi
      .spyOn(service, 'getCatalogIndex')
      .mockResolvedValue(catalog(fixture.skills));
    const unsync = vi.spyOn(service, 'unsyncFromAgents').mockResolvedValue();

    await expect(
      service.setSkillsDisabled(
        [fixture.skills[0].key, fixture.skills[1].key, fixture.skills[0].key],
        true
      )
    ).resolves.toBe(2);

    expect(getCatalog).toHaveBeenCalledTimes(1);
    expect(unsync).toHaveBeenCalledTimes(2);
    for (const skill of fixture.skills) {
      await expect(
        fs.promises.access(path.join(skill.localPath!, 'SKILL.md.disabled'))
      ).resolves.toBe(undefined);
      await expect(
        fs.promises.access(path.join(skill.localPath!, 'SKILL.md'))
      ).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('preflights the whole batch before changing any skill', async () => {
    const fixture = await createFixture(['lovstudio-alpha', 'lovstudio-beta']);
    await fs.promises.writeFile(
      path.join(fixture.skills[1].localPath!, 'SKILL.md.disabled'),
      '# conflicting marker\n'
    );
    const service = new SkillsService();
    vi.spyOn(service, 'initialize').mockResolvedValue();
    vi.spyOn(service, 'getCatalogIndex').mockResolvedValue(catalog(fixture.skills));
    vi.spyOn(service, 'unsyncFromAgents').mockResolvedValue();

    await expect(
      service.setSkillsDisabled(
        fixture.skills.map((skill) => skill.key),
        true
      )
    ).rejects.toThrow('disabled skill file already exists');

    await expect(
      fs.promises.access(path.join(fixture.skills[0].localPath!, 'SKILL.md'))
    ).resolves.toBe(undefined);
  });
});
