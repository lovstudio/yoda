import { describe, expect, it } from 'vitest';
import type { CatalogSkill, SkillScope } from '@shared/skills/types';
import { compactSkillLocationPath, skillLocationKind, sortSkillLocations } from './skill-location';

function skill(key: string, localPath: string, scope: SkillScope = 'user'): CatalogSkill {
  return {
    key,
    ref: { key, id: 'frontend-design', source: 'local', locator: localPath },
    id: 'frontend-design',
    displayName: 'frontend-design',
    description: 'Frontend design guidance',
    source: 'local',
    scope,
    managed: scope === 'managed',
    frontmatter: { name: 'frontend-design', description: 'Frontend design guidance' },
    installed: true,
    localPath,
  };
}

describe('skill installation locations', () => {
  it('identifies common runtime and plugin locations', () => {
    expect(skillLocationKind(skill('claude', '/Users/mark/.claude/skills/design'))).toBe('claude');
    expect(
      skillLocationKind(
        skill(
          'cache',
          '/Users/mark/.claude/plugins/cache/official/design/1.0/skills/design',
          'plugin'
        )
      )
    ).toBe('claudePluginCache');
    expect(
      skillLocationKind(
        skill(
          'marketplace',
          '/Users/mark/.claude/plugins/marketplaces/official/plugins/design/skills/design',
          'plugin'
        )
      )
    ).toBe('claudePluginMarketplace');
    expect(skillLocationKind(skill('codex', '/Users/mark/.codex/skills/design'))).toBe('codex');
    expect(
      skillLocationKind(
        skill(
          'codex-marketplace',
          '/Users/mark/.codex/.tmp/marketplaces/official/plugins/design/skills/design',
          'plugin'
        )
      )
    ).toBe('codexPluginMarketplace');
    expect(skillLocationKind(skill('agents', '/Users/mark/.agents/skills/design'))).toBe('agents');
    expect(skillLocationKind(skill('managed', '/Users/mark/.agentskills/design', 'managed'))).toBe(
      'yoda'
    );
  });

  it('shortens home-relative paths without hiding project paths', () => {
    expect(compactSkillLocationPath(skill('claude', '/Users/mark/.claude/skills/design'))).toBe(
      '~/.claude/skills/design'
    );
    expect(
      compactSkillLocationPath(
        skill('project', '/Users/mark/project/.claude/skills/design', 'project')
      )
    ).toBe('/Users/mark/project/.claude/skills/design');
  });

  it('keeps a stable order when the active location changes', () => {
    const locations = [
      skill('claude', '/Users/mark/.claude/skills/design'),
      skill('codex', '/Users/mark/.codex/skills/design'),
      skill('agents', '/Users/mark/.agents/skills/design'),
    ];

    expect(sortSkillLocations(locations).map((location) => location.key)).toEqual([
      'agents',
      'claude',
      'codex',
    ]);
  });
});
