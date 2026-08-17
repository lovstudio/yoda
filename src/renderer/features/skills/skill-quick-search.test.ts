import { describe, expect, it } from 'vitest';
import type { CatalogSkill } from '@shared/skills/types';
import { filterInstalledSkills, hasInstalledRuntimeName } from './skill-quick-search';

function skill(overrides: Partial<CatalogSkill>): CatalogSkill {
  const merged = {
    key: 'skill:local:calendar:test',
    ref: {
      key: 'skill:local:calendar:test',
      id: 'calendar',
      source: 'local' as const,
      locator: '/tmp/calendar',
    },
    id: 'calendar',
    displayName: 'Calendar',
    description: 'Manage meetings',
    source: 'local' as const,
    scope: 'user' as const,
    managed: false,
    installed: true,
    ...overrides,
  };
  return {
    ...merged,
    frontmatter: overrides.frontmatter ?? { name: merged.id, description: merged.description },
  };
}

describe('skill quick search', () => {
  it('searches only installed skills across name, id and description', () => {
    const skills = [
      skill({}),
      skill({ key: 'catalog', id: 'calendar-pro', displayName: 'Calendar Pro', installed: false }),
      skill({ key: 'notes', id: 'notes', displayName: 'Notes', description: 'Write drafts' }),
    ];

    expect(filterInstalledSkills(skills, 'meeting').map((item) => item.id)).toEqual(['calendar']);
    expect(filterInstalledSkills(skills, '').map((item) => item.id)).toEqual(['calendar', 'notes']);
  });

  it('ranks name matches above description matches', () => {
    const skills = [
      skill({
        key: 'poster',
        id: 'event-poster',
        displayName: 'Event Poster',
        description: 'Design a poster, a solution for offline events',
      }),
      skill({
        key: 'architect',
        id: 'solution-architect',
        displayName: 'Solution Architect',
        description: 'Plan a feature end to end',
      }),
      skill({
        key: 'resolver',
        id: 'conflict-resolver',
        displayName: 'Conflict Resolver',
        description: 'Propose a resolution',
      }),
    ];

    // "resolution" contains "solution": description hits are kept, but they land
    // below the name hit and stay in alphabetical order among themselves.
    expect(filterInstalledSkills(skills, 'solution').map((item) => item.id)).toEqual([
      'solution-architect',
      'conflict-resolver',
      'event-poster',
    ]);
  });

  it('shows one row per logical skill installed in several places', () => {
    const skills = [
      skill({ key: 'user-copy', scope: 'user' }),
      skill({ key: 'project-copy', scope: 'project' }),
    ];

    expect(filterInstalledSkills(skills, 'calendar').map((item) => item.key)).toEqual([
      'project-copy',
    ]);
  });

  it('detects same runtime names before external installation', () => {
    expect(hasInstalledRuntimeName([skill({})], 'calendar')).toBe(true);
    expect(hasInstalledRuntimeName([skill({})], 'calendar-pro')).toBe(false);
  });
});
