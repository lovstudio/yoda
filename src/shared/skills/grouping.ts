import type { CatalogSkill, SkillUsageStat } from './types';

export interface SkillContentVariant {
  /** Content identity. Catalog entries without a hash stay independent. */
  key: string;
  primary: CatalogSkill;
  members: CatalogSkill[];
}

export interface SkillFamily {
  /** Logical runtime identity, normally the normalized frontmatter name. */
  key: string;
  primary: CatalogSkill;
  members: CatalogSkill[];
  variants: SkillContentVariant[];
}

export interface GroupSkillFamiliesOptions {
  /** Keep a persisted/current key or legacy runtime id as the visible representative. */
  preferredKeys?: ReadonlySet<string>;
}

function normalizeIdentity(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase();
}

/**
 * Runtime name is the closest available logical identity. Directory names may
 * include a package/version suffix, so prefer the declared Agent Skills name.
 */
export function skillFamilyKey(skill: CatalogSkill): string {
  return normalizeIdentity(skill.frontmatter.name || skill.displayName || skill.id);
}

function scopePriority(skill: CatalogSkill): number {
  switch (skill.scope) {
    case 'project':
      return 5;
    case 'managed':
      return 4;
    case 'user':
      return 3;
    case 'plugin':
      return 2;
    case 'catalog':
      return 1;
  }
}

function skillPriority(skill: CatalogSkill, preferredKeys?: ReadonlySet<string>): number {
  let priority = 0;
  if (preferredKeys?.has(skill.key) || preferredKeys?.has(skill.id)) priority += 100_000;
  if (skill.installed) priority += 10_000;
  if (!skill.disabled) priority += 1_000;
  priority += scopePriority(skill) * 100;
  priority += Math.min(skill.installation?.runtimeIds.length ?? 0, 9) * 10;
  if (skill.managed) priority += 5;
  if (!skill.validationIssues?.some((issue) => issue.severity === 'error')) priority += 1;
  return priority;
}

function choosePrimary(skills: CatalogSkill[], preferredKeys?: ReadonlySet<string>): CatalogSkill {
  return [...skills].sort((left, right) => {
    const priority = skillPriority(right, preferredKeys) - skillPriority(left, preferredKeys);
    return priority || left.key.localeCompare(right.key);
  })[0];
}

function contentVariantKey(skill: CatalogSkill): string {
  const hash = skill.contentHash ?? skill.ref.contentHash;
  return hash ? `content:${hash}` : `instance:${skill.key}`;
}

/**
 * Project a flat registry into the hierarchy users reason about:
 * logical skill -> content variants -> physical/catalog instances.
 */
export function groupSkillFamilies(
  skills: CatalogSkill[],
  options: GroupSkillFamiliesOptions = {}
): SkillFamily[] {
  const memberGroups = new Map<string, CatalogSkill[]>();
  for (const skill of skills) {
    const key = skillFamilyKey(skill);
    const members = memberGroups.get(key) ?? [];
    members.push(skill);
    memberGroups.set(key, members);
  }

  return Array.from(memberGroups, ([key, members]) => {
    const variantMembers = new Map<string, CatalogSkill[]>();
    for (const member of members) {
      const variantKey = contentVariantKey(member);
      const grouped = variantMembers.get(variantKey) ?? [];
      grouped.push(member);
      variantMembers.set(variantKey, grouped);
    }

    return {
      key,
      primary: choosePrimary(members, options.preferredKeys),
      members,
      variants: Array.from(variantMembers, ([variantKey, grouped]) => ({
        key: variantKey,
        primary: choosePrimary(grouped, options.preferredKeys),
        members: grouped,
      })),
    };
  });
}

export function selectSkillFamilyRepresentatives(
  skills: CatalogSkill[],
  options?: GroupSkillFamiliesOptions
): CatalogSkill[] {
  return groupSkillFamilies(skills, options).map((family) => family.primary);
}

export function skillFamilyLocationCount(family: SkillFamily): number {
  return family.members.filter((member) => member.installed && member.localPath).length;
}

/** Aggregate each runtime identity once; aliases pointing at the same stat are not double-counted. */
export function aggregateSkillFamilyUsage(
  family: SkillFamily,
  lookupUsage: (skillId: string) => SkillUsageStat | undefined
): SkillUsageStat | undefined {
  const stats = new Map<string, SkillUsageStat>();
  for (const id of new Set(family.members.map((member) => member.id.toLocaleLowerCase()))) {
    const usage = lookupUsage(id);
    if (!usage) continue;
    stats.set(usage.skill.toLocaleLowerCase(), usage);
  }
  if (stats.size === 0) return undefined;

  const daily: Record<string, number> = {};
  let total = 0;
  let manual = 0;
  let auto = 0;
  let lastUsedAt: string | null = null;
  for (const usage of stats.values()) {
    total += usage.total;
    manual += usage.manual;
    auto += usage.auto;
    if (usage.lastUsedAt && (!lastUsedAt || usage.lastUsedAt > lastUsedAt)) {
      lastUsedAt = usage.lastUsedAt;
    }
    for (const [date, count] of Object.entries(usage.daily)) {
      daily[date] = (daily[date] ?? 0) + count;
    }
  }

  return { skill: family.key, total, manual, auto, lastUsedAt, daily };
}
