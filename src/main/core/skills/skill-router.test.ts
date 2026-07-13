import { describe, expect, it } from 'vitest';
import type { CatalogSkill } from '@shared/skills/types';
import { routeSkills } from './skill-router';

function skill(key: string, id: string, description: string): CatalogSkill {
  return {
    key,
    ref: { key, id, source: 'local', locator: `/skills/${id}` },
    id,
    displayName: id,
    description,
    source: 'local',
    scope: 'managed',
    managed: true,
    frontmatter: { name: id, description },
    installed: true,
    localPath: `/skills/${id}`,
  };
}

const skills = [
  skill('skill:deploy', 'cloudflare-deploy', 'Deploy Workers and Pages to Cloudflare'),
  skill('skill:pdf', 'pdf-review', 'Read and review PDF documents'),
  skill('skill:release', 'release-notes', 'Write release notes and changelogs'),
];

describe('skill router', () => {
  it('ranks the intended installed skill', () => {
    const result = routeSkills({
      query: 'Please deploy this Worker to Cloudflare',
      skills,
      limit: 2,
    });
    expect(result[0]?.skillKey).toBe('skill:deploy');
    expect(result[0]?.confidence).not.toBe('low');
  });

  it('honors the Agent active set, including legacy logical ids', () => {
    expect(
      routeSkills({
        query: 'Review this PDF document',
        skills,
        allowedSkillKeys: new Set(['cloudflare-deploy']),
      })
    ).toEqual([]);
  });

  it('returns no suggestion for unrelated intent', () => {
    expect(routeSkills({ query: 'hello there', skills })).toEqual([]);
  });

  it('lets one logical skill occupy only one candidate slot', () => {
    const duplicate = {
      ...skills[0],
      key: 'skill:deploy:plugin-copy',
      ref: {
        ...skills[0].ref,
        key: 'skill:deploy:plugin-copy',
        locator: '/plugins/cloudflare-deploy',
      },
      localPath: '/plugins/cloudflare-deploy',
      scope: 'plugin' as const,
    };
    const result = routeSkills({
      query: 'Deploy this Worker to Cloudflare',
      skills: [skills[0], duplicate],
      limit: 8,
    });

    expect(result).toHaveLength(1);
    expect(result[0].skillKey).toBe('skill:deploy');
  });
});
