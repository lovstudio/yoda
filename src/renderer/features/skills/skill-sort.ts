import type { CatalogSkill, SkillUsageStat } from '@shared/skills/types';

/** 'name' is always available; usage-based modes need skillusage stats. */
export const SKILL_SORT_MODES = ['name', 'total', 'manual', 'auto', 'recent'] as const;

export type SkillSortMode = (typeof SKILL_SORT_MODES)[number];

/**
 * Sort catalog skills by name or by real usage stats. Usage ties (and skills
 * without stats) keep their relative order — Array.prototype.sort is stable.
 */
export function sortSkills(
  skills: CatalogSkill[],
  mode: SkillSortMode,
  lookupUsage: (skillId: string) => SkillUsageStat | undefined
): CatalogSkill[] {
  return [...skills].sort((a, b) => {
    if (mode === 'name') {
      return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
    }
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
