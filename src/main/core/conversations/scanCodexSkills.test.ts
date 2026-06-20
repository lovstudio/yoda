import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanCodexSkills } from './scanCodexSkills';

describe('scanCodexSkills', () => {
  let dir: string;
  let home: string;
  let codexHome: string;
  let cwd: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'yoda-codex-skills-'));
    home = join(dir, 'home');
    codexHome = join(home, '.codex');
    cwd = join(dir, 'repo');
    mkdirSync(home, { recursive: true });
    mkdirSync(cwd, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('scans standard .agents skills, legacy Codex skills, symlinks, plugins, and project overrides', async () => {
    writeSkill(join(codexHome, 'skills', 'legacy-skill'), {
      name: 'legacy-skill',
      description: 'Legacy Codex skill',
    });
    writeSkill(join(codexHome, 'skills', '.system', 'skill-creator'), {
      name: 'skill-creator',
      description: 'System skill',
    });
    writeSkill(join(home, '.agents', 'skills', 'agent-skill'), {
      name: 'Agent Skill',
      description: 'Standard agent skill',
    });
    writeSkill(join(home, '.agents', 'skills', 'folded-description'), {
      name: 'folded-description',
      description: 'first folded line\nsecond folded line',
      folded: true,
    });
    writeSkill(join(home, '.agents', 'skills', 'override-me'), {
      name: 'override-me',
      description: 'Global description',
    });
    writeSkill(join(cwd, '.agents', 'skills', 'override-me'), {
      name: 'override-me',
      description: 'Project description',
    });
    writeSkill(
      join(codexHome, 'plugins', 'cache', 'openai-curated', 'github', 'abc', 'skills', 'gh-fix-ci'),
      {
        name: 'gh-fix-ci',
        description: 'Plugin skill',
      }
    );
    writeSkill(join(home, '.agents', 'skills', 'plugin-override'), {
      name: 'github:gh-fix-ci',
      description: 'User override for plugin skill',
    });

    const linkedTarget = join(dir, 'linked-target');
    writeSkill(linkedTarget, {
      name: 'linked-skill',
      description: 'Linked skill',
    });
    mkdirSync(join(home, '.agents', 'skills'), { recursive: true });
    // Windows cannot create symlinks without Developer Mode / elevation.
    let linkedCreated = false;
    try {
      symlinkSync(linkedTarget, join(home, '.agents', 'skills', 'linked-skill'), 'dir');
      linkedCreated = true;
    } catch {
      linkedCreated = false;
    }

    const skills = await scanCodexSkills(cwd, { home, codexHome });
    const byName = new Map(skills.map((skill) => [skill.name, skill]));

    expect(byName.get('legacy-skill')?.description).toBe('Legacy Codex skill');
    expect(byName.get('.system:skill-creator')?.description).toBe('System skill');
    expect(byName.get('Agent Skill')?.description).toBe('Standard agent skill');
    expect(byName.get('folded-description')?.description).toBe(
      'first folded line second folded line'
    );
    expect(byName.get('override-me')?.description).toBe('Project description');
    if (linkedCreated) {
      expect(byName.get('linked-skill')?.path).toBe(join(realpathSync(linkedTarget), 'SKILL.md'));
    }
    expect(byName.get('github:gh-fix-ci')?.description).toBe('User override for plugin skill');
  });
});

function writeSkill(
  dir: string,
  {
    name,
    description,
    folded = false,
  }: {
    name: string;
    description: string;
    folded?: boolean;
  }
): void {
  mkdirSync(dir, { recursive: true });
  const descriptionYaml = folded
    ? `description: >\n${description
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n')}`
    : `description: ${description}`;
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\n${descriptionYaml}\n---\n\n# ${name}\n`
  );
}
