import { describe, expect, it } from 'vitest';
import type { SkillSessionPolicy } from '@shared/skills/types';
import { skillSelectionForReload } from './restart-skill-policy';

const policy: SkillSessionPolicy = {
  source: 'agent-profile',
  restriction: 'allowlist',
  entries: [
    {
      key: 'skill:local:auto',
      id: 'auto',
      path: '/tmp/auto',
      contentHash: 'auto-hash',
      mode: 'auto',
      scope: 'user',
    },
    {
      key: 'skill:local:manual',
      id: 'manual',
      path: '/tmp/manual',
      contentHash: 'manual-hash',
      mode: 'manual',
      scope: 'user',
    },
  ],
  available: [],
  warnings: [],
  createdAt: '2026-07-23T00:00:00.000Z',
};

describe('skillSelectionForReload', () => {
  it('adds the installed skill while preserving existing invocation modes', () => {
    expect(skillSelectionForReload(policy, 'skill:local:new')).toEqual({
      restriction: 'allowlist',
      autoSkillKeys: ['skill:local:auto', 'skill:local:new'],
      manualSkillKeys: ['skill:local:manual'],
    });
  });

  it('does not duplicate an already-enabled skill or restrict an unrestricted session', () => {
    expect(skillSelectionForReload(policy, 'skill:local:manual')).toEqual({
      restriction: 'allowlist',
      autoSkillKeys: ['skill:local:auto'],
      manualSkillKeys: ['skill:local:manual'],
    });
    expect(skillSelectionForReload(undefined, 'skill:local:new')).toBeNull();
  });
});
