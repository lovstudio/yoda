import { describe, expect, it } from 'vitest';
import type { SkillSessionPolicy } from '@shared/skills/types';
import { buildClaudeSkillOverrides, buildCodexSkillConfig } from './skill-runtime-policy';

function policy(): SkillSessionPolicy {
  return {
    source: 'agent-profile',
    entries: [
      {
        key: 'auto',
        id: 'docs',
        path: '/skills/docs-auto',
        contentHash: 'a',
        mode: 'auto',
        scope: 'managed',
      },
      {
        key: 'manual',
        id: 'release',
        path: '/skills/release',
        contentHash: 'b',
        mode: 'manual',
        scope: 'user',
      },
      {
        key: 'plugin',
        id: 'plugin-tool',
        path: '/plugins/tool',
        contentHash: 'c',
        mode: 'auto',
        scope: 'plugin',
      },
    ],
    available: [
      { key: 'auto', id: 'docs', path: '/skills/docs-auto', scope: 'managed' },
      { key: 'other-docs', id: 'docs', path: '/skills/docs-other', scope: 'user' },
      { key: 'manual', id: 'release', path: '/skills/release', scope: 'user' },
      { key: 'off', id: 'unused', path: '/skills/unused', scope: 'project' },
      { key: 'plugin', id: 'plugin-tool', path: '/plugins/tool', scope: 'plugin' },
    ],
    warnings: [],
    createdAt: new Date(0).toISOString(),
  };
}

describe('skill runtime policy adapters', () => {
  it('maps Claude automatic, manual-only and off modes without touching plugins', () => {
    expect(buildClaudeSkillOverrides(policy())).toEqual({
      docs: 'on',
      release: 'user-invocable-only',
      unused: 'off',
    });
  });

  it('builds an exact Codex path configuration and omits plugin-owned skills', () => {
    const config = buildCodexSkillConfig(policy());
    expect(config).toContain('path="/skills/docs-auto/SKILL.md",enabled=true');
    expect(config).toContain('path="/skills/docs-other/SKILL.md",enabled=false');
    expect(config).toContain('path="/skills/release/SKILL.md",enabled=true');
    expect(config).toContain('path="/skills/unused/SKILL.md",enabled=false');
    expect(config).not.toContain('/plugins/tool');
  });
});
