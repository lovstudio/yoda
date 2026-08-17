import { selectSkillFamilyRepresentatives } from '@shared/skills/grouping';
import type { CatalogSkill } from '@shared/skills/types';

/**
 * Match tiers, best first. Descriptions are long prose: a query like "solution"
 * hits a dozen of them while naming exactly one skill, so a description-only
 * match must never outrank a name match.
 */
const RANK_EXACT = 0;
const RANK_NAME_PREFIX = 1;
const RANK_NAME_PART = 2;
const RANK_DESCRIPTION = 3;
const RANK_NONE = 4;

function skillNames(skill: CatalogSkill): string[] {
  return [skill.frontmatter.name, skill.displayName, skill.id].filter((value): value is string =>
    Boolean(value)
  );
}

function rankSkill(skill: CatalogSkill, query: string): number {
  let best = RANK_NONE;
  for (const name of skillNames(skill)) {
    const value = name.toLocaleLowerCase();
    if (value === query) return RANK_EXACT;
    if (value.startsWith(query)) best = Math.min(best, RANK_NAME_PREFIX);
    else if (value.includes(query)) best = Math.min(best, RANK_NAME_PART);
  }
  if (best !== RANK_NONE) return best;
  return skill.description?.toLocaleLowerCase().includes(query) ? RANK_DESCRIPTION : RANK_NONE;
}

function byDisplayName(left: CatalogSkill, right: CatalogSkill): number {
  return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' });
}

/**
 * Installed skills for the quick picker, one row per logical skill (the same
 * skill installed at user and project scope is one entry) and ordered by how
 * well it matches the query.
 */
export function filterInstalledSkills(
  skills: readonly CatalogSkill[],
  query: string
): CatalogSkill[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const installed = selectSkillFamilyRepresentatives(skills.filter((skill) => skill.installed));
  if (!normalizedQuery) return installed.sort(byDisplayName);

  return installed
    .map((skill) => ({ skill, rank: rankSkill(skill, normalizedQuery) }))
    .filter((entry) => entry.rank !== RANK_NONE)
    .sort((left, right) => left.rank - right.rank || byDisplayName(left.skill, right.skill))
    .map((entry) => entry.skill);
}

export function hasInstalledRuntimeName(skills: readonly CatalogSkill[], skillId: string): boolean {
  return skills.some((skill) => skill.installed && skill.id === skillId);
}
