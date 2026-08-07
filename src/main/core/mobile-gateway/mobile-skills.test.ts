import { describe, expect, it } from 'vitest';
import type { CatalogIndex, CatalogSkill } from '@shared/skills/types';
import { mobileSkillSummaries } from './mobile-skills';

function skill(input: Partial<CatalogSkill> & Pick<CatalogSkill, 'key' | 'id'>): CatalogSkill {
  return {
    displayName: input.id,
    description: `${input.id} description`,
    source: 'local',
    scope: 'user',
    managed: false,
    installed: true,
    frontmatter: { name: input.id, description: `${input.id} description` },
    ref: {
      key: input.key,
      id: input.id,
      source: 'local',
      locator: `/skills/${input.id}`,
    },
    ...input,
  };
}

function catalog(skills: CatalogSkill[]): CatalogIndex {
  return { version: 1, lastUpdated: '2026-08-07T00:00:00.000Z', skills };
}

describe('mobile Skill catalog', () => {
  it('keeps one enabled installed representative per Skill family', () => {
    expect(
      mobileSkillSummaries(
        catalog([
          skill({ key: 'user:design', id: 'frontend-design' }),
          skill({
            key: 'project:design',
            id: 'frontend-design-project',
            scope: 'project',
            frontmatter: { name: 'frontend-design', description: 'Project version' },
          }),
          skill({ key: 'disabled', id: 'disabled', disabled: true }),
          skill({ key: 'catalog', id: 'catalog-only', installed: false, scope: 'catalog' }),
        ])
      )
    ).toEqual([
      {
        key: 'project:design',
        id: 'frontend-design-project',
        displayName: 'frontend-design-project',
        description: 'frontend-design-project description',
      },
    ]);
  });

  it('respects a session allowlist while retaining plugin-controlled Skills', () => {
    const allowed = skill({ key: 'allowed', id: 'allowed-skill' });
    const excluded = skill({ key: 'excluded', id: 'excluded-skill' });
    const plugin = skill({ key: 'plugin', id: 'plugin-skill', scope: 'plugin' });

    expect(
      mobileSkillSummaries(catalog([allowed, excluded, plugin]), new Set(['allowed']))
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'allowed' }),
        expect.objectContaining({ key: 'plugin' }),
      ])
    );
    expect(
      mobileSkillSummaries(catalog([allowed, excluded, plugin]), new Set(['allowed']))
    ).not.toEqual(expect.arrayContaining([expect.objectContaining({ key: 'excluded' })]));
  });
});
