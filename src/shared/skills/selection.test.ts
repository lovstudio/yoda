import { describe, expect, it } from 'vitest';
import { normalizeSkillSelection } from './selection';
import type { SkillSelectionInput } from './types';

describe('normalizeSkillSelection', () => {
  it('treats an empty Agent profile as no runtime restriction', () => {
    expect(normalizeSkillSelection({ autoSkillKeys: [], manualSkillKeys: [] })).toBeUndefined();
  });

  it('preserves an explicitly configured profile', () => {
    const selection: SkillSelectionInput = {
      autoSkillKeys: ['docs'],
      manualSkillKeys: ['release'],
    };

    expect(normalizeSkillSelection(selection)).toBe(selection);
  });

  it('preserves an explicitly empty allowlist', () => {
    const selection: SkillSelectionInput = {
      restriction: 'allowlist',
      autoSkillKeys: [],
      manualSkillKeys: [],
    };

    expect(normalizeSkillSelection(selection)).toBe(selection);
  });
});
