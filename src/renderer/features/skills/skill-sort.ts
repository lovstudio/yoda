import type { CatalogSkill, SkillUsageStat } from '@shared/skills/types';

export const SKILL_SORT_MODES = ['default', 'total', 'manual', 'auto', 'recent'] as const;

export type SkillSortMode = (typeof SKILL_SORT_MODES)[number];

/**
 * Sort catalog skills by real usage stats. Ties (and skills without stats)
 * keep their catalog order — Array.prototype.sort is stable.
 */
export function sortSkillsByUsage(
  skills: CatalogSkill[],
  mode: SkillSortMode,
  lookupUsage: (skillId: string) => SkillUsageStat | undefined
): CatalogSkill[] {
  if (mode === 'default') return skills;
  return [...skills].sort((a, b) => {
    const ua = lookupUsage(a.id);
    const ub = lookupUsage(b.id);
    switch (mode) {
      case 'total':
        return (ub?.total ?? 0) - (ua?.total ?? 0);
      case 'manual':
        return (ub?.manual ?? 0) - (ua?.manual ?? 0);
      case 'auto':
        return (ub?.auto ?? 0) - (ua?.auto ?? 0);
      case 'recent':
        return (ub?.lastUsedAt ?? '').localeCompare(ua?.lastUsedAt ?? '');
    }
  });
}
