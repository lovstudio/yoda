import { describe, expect, it } from 'vitest';
import type { CatalogSkill, SkillUsageStat } from '@shared/skills/types';
import { sortSkills } from './skill-sort';

function skill(id: string): CatalogSkill {
  return {
    key: `skill:local:${id}`,
    ref: {
      key: `skill:local:${id}`,
      id,
      source: 'local',
      locator: `/skills/${id}`,
    },
    id,
    displayName: id,
    description: `${id} skill`,
    source: 'local',
    scope: 'user',
    managed: false,
    frontmatter: { name: id, description: `${id} skill` },
    installed: true,
  };
}

function usage(skillId: string, total: number): SkillUsageStat {
  return {
    skill: skillId,
    total,
    manual: total,
    auto: 0,
    lastUsedAt: null,
    daily: {},
  };
}

describe('skill sorting', () => {
  it('sorts skills by invocation count from highest to lowest', () => {
    const skills = [skill('alpha'), skill('beta'), skill('gamma')];
    const usageBySkill = new Map([
      ['alpha', usage('alpha', 12)],
      ['beta', usage('beta', 38)],
    ]);

    const sorted = sortSkills(skills, 'total', (item) => usageBySkill.get(item.id));

    expect(sorted.map((item) => item.id)).toEqual(['beta', 'alpha', 'gamma']);
    expect(skills.map((item) => item.id)).toEqual(['alpha', 'beta', 'gamma']);
  });
});
