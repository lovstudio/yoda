import { describe, expect, it } from 'vitest';
import {
  aggregateSkillFamilyUsage,
  groupSkillFamilies,
  selectSkillFamilyRepresentatives,
  skillFamilyLocationCount,
} from './grouping';
import type { CatalogSkill, SkillScope, SkillUsageStat } from './types';

function skill(args: {
  key: string;
  id?: string;
  name?: string;
  hash?: string;
  scope?: SkillScope;
  installed?: boolean;
}): CatalogSkill {
  const id = args.id ?? args.name ?? 'frontend-design';
  const name = args.name ?? id;
  const installed = args.installed ?? true;
  const scope = args.scope ?? 'user';
  return {
    key: args.key,
    ref: {
      key: args.key,
      id,
      source: 'local',
      locator: `/skills/${args.key}`,
      contentHash: args.hash,
    },
    id,
    displayName: name,
    description: 'Frontend design guidance',
    source: 'local',
    scope,
    managed: scope === 'managed',
    frontmatter: { name, description: 'Frontend design guidance' },
    installed,
    localPath: installed ? `/skills/${args.key}` : undefined,
    contentHash: args.hash,
  };
}

describe('skill family grouping', () => {
  it('separates logical skills, content variants, and installation locations', () => {
    const families = groupSkillFamilies([
      skill({
        key: 'user-versioned',
        id: 'frontend-design-3-0.1.0',
        name: 'frontend-design',
        hash: 'a',
      }),
      skill({ key: 'user-current', hash: 'b' }),
      skill({ key: 'plugin-cache', hash: 'c', scope: 'plugin' }),
      skill({ key: 'plugin-marketplace', hash: 'c', scope: 'plugin' }),
      skill({ key: 'claude-copy', hash: 'c' }),
      skill({ key: 'anthropic-copy', hash: 'd', scope: 'plugin' }),
      skill({ key: 'codex-copy', hash: 'e', scope: 'plugin' }),
    ]);

    expect(families).toHaveLength(1);
    expect(families[0].members).toHaveLength(7);
    expect(families[0].variants).toHaveLength(5);
    expect(
      families[0].variants.find((variant) => variant.key === 'content:c')?.members
    ).toHaveLength(3);
    expect(skillFamilyLocationCount(families[0])).toBe(7);
  });

  it('prefers project and managed instances while honoring an explicit persisted key', () => {
    const candidates = [
      skill({ key: 'plugin', hash: 'a', scope: 'plugin' }),
      skill({ key: 'managed', hash: 'b', scope: 'managed' }),
      skill({ key: 'project', hash: 'c', scope: 'project' }),
    ];

    expect(selectSkillFamilyRepresentatives(candidates)[0].key).toBe('project');
    expect(
      selectSkillFamilyRepresentatives(candidates, {
        preferredKeys: new Set(['plugin']),
      })[0].key
    ).toBe('plugin');
  });

  it('honors a legacy runtime id when choosing a representative', () => {
    const candidates = [
      skill({ key: 'current', id: 'frontend-design', name: 'frontend-design', hash: 'a' }),
      skill({
        key: 'versioned',
        id: 'frontend-design-3-0.1.0',
        name: 'frontend-design',
        hash: 'b',
      }),
    ];

    expect(
      selectSkillFamilyRepresentatives(candidates, {
        preferredKeys: new Set(['frontend-design-3-0.1.0']),
      })[0].key
    ).toBe('versioned');
  });

  it('counts each runtime usage identity once instead of once per installation path', () => {
    const family = groupSkillFamilies([
      skill({ key: 'one', id: 'frontend-design', hash: 'a' }),
      skill({ key: 'two', id: 'frontend-design', hash: 'b' }),
      skill({
        key: 'versioned',
        id: 'frontend-design-3-0.1.0',
        name: 'frontend-design',
        hash: 'c',
      }),
    ])[0];
    const main: SkillUsageStat = {
      skill: 'frontend-design',
      total: 293,
      manual: 3,
      auto: 290,
      lastUsedAt: '2026-07-12T00:00:00.000Z',
      daily: { '2026-07-12': 293 },
    };
    const versioned: SkillUsageStat = {
      skill: 'frontend-design-3-0.1.0',
      total: 2,
      manual: 2,
      auto: 0,
      lastUsedAt: '2026-07-13T00:00:00.000Z',
      daily: { '2026-07-13': 2 },
    };
    const usage = aggregateSkillFamilyUsage(family, (id) =>
      id === 'frontend-design' ? main : id === 'frontend-design-3-0.1.0' ? versioned : undefined
    );

    expect(usage).toEqual({
      skill: 'frontend-design',
      total: 295,
      manual: 5,
      auto: 290,
      lastUsedAt: '2026-07-13T00:00:00.000Z',
      daily: { '2026-07-12': 293, '2026-07-13': 2 },
    });
  });
});
