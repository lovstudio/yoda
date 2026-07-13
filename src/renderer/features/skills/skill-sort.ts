import type { CatalogSkill, SkillUsageStat } from '@shared/skills/types';
import { parseFrontmatter } from '@shared/skills/validation';

/**
 * 'name' is always available; usage-based modes need skillusage stats;
 * 'count' (group member count) only applies to the tree layout.
 * 'trigger' ranks by name+description length (the skill's trigger surface —
 * what agents match against); 'body' ranks by SKILL.md body length (a rough
 * quality signal).
 */
export const SKILL_SORT_MODES = [
  'name',
  'count',
  'trigger',
  'body',
  'total',
  'manual',
  'auto',
  'recent',
] as const;

export type SkillSortMode = (typeof SKILL_SORT_MODES)[number];

function triggerTextLength(skill: CatalogSkill): number {
  const name = skill.frontmatter.name || skill.displayName;
  const description = skill.description || skill.frontmatter.description || '';
  return name.length + description.length;
}

/** Uninstalled catalog skills load SKILL.md lazily — treat them as empty. */
function bodyLength(skill: CatalogSkill): number {
  if (!skill.skillMdContent) return 0;
  return parseFrontmatter(skill.skillMdContent).body.trim().length;
}

/**
 * Sort catalog skills by name, content length, or real usage stats. Ties (and
 * skills without stats) keep their relative order — Array.prototype.sort is
 * stable. 'count' is a group-level order; at the skill level it falls back to
 * name.
 */
export function sortSkills(
  skills: CatalogSkill[],
  mode: SkillSortMode,
  lookupUsage: (skill: CatalogSkill) => SkillUsageStat | undefined
): CatalogSkill[] {
  if (mode === 'trigger' || mode === 'body') {
    // Decorate-sort: measuring inside the comparator would re-parse per compare.
    const measure = mode === 'trigger' ? triggerTextLength : bodyLength;
    const lengths = new Map(skills.map((skill) => [skill.key, measure(skill)]));
    return [...skills].sort((a, b) => (lengths.get(b.key) ?? 0) - (lengths.get(a.key) ?? 0));
  }

  return [...skills].sort((a, b) => {
    if (mode === 'name' || mode === 'count') {
      return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
    }
    const ua = lookupUsage(a);
    const ub = lookupUsage(b);
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
