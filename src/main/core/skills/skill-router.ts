import type { CatalogSkill, SkillRouteSuggestion } from '@shared/skills/types';

const LATIN_TOKEN_RE = /[a-z0-9][a-z0-9+_.-]*/g;
const CJK_RUN_RE = /[\u3400-\u9fff\uf900-\ufaff]+/g;
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'for',
  'in',
  'of',
  'on',
  'please',
  'the',
  'to',
  'use',
  'with',
  '帮我',
  '一下',
  '使用',
  '请',
]);

function tokenize(value: string): string[] {
  const normalized = value.toLocaleLowerCase();
  const tokens: string[] = normalized.match(LATIN_TOKEN_RE) ?? [];
  for (const run of normalized.match(CJK_RUN_RE) ?? []) {
    if (run.length <= 2) {
      tokens.push(run);
      continue;
    }
    for (let index = 0; index < run.length - 1; index += 1) {
      tokens.push(run.slice(index, index + 2));
    }
  }
  return tokens.filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function tokenFrequency(tokens: string[]): Map<string, number> {
  const frequency = new Map<string, number>();
  for (const token of tokens) frequency.set(token, (frequency.get(token) ?? 0) + 1);
  return frequency;
}

function fields(skill: CatalogSkill): Array<{ value: string; weight: number }> {
  return [
    { value: `${skill.id} ${skill.displayName} ${skill.workflowId ?? ''}`, weight: 4.5 },
    {
      value: `${skill.description} ${skill.frontmatter.description} ${skill.frontmatter.when_to_use ?? ''}`,
      weight: 2.2,
    },
    { value: `${skill.defaultPrompt ?? ''} ${skill.variant ?? ''}`, weight: 1.2 },
  ];
}

function candidateScore(skill: CatalogSkill, query: string, idf: Map<string, number>): number {
  const queryTokens = tokenFrequency(tokenize(query));
  if (queryTokens.size === 0) return 0;
  let score = 0;
  for (const field of fields(skill)) {
    const lower = field.value.toLocaleLowerCase();
    const documentTokens = tokenFrequency(tokenize(field.value));
    for (const [token, queryCount] of queryTokens) {
      const count = documentTokens.get(token) ?? 0;
      if (count > 0)
        score += field.weight * (idf.get(token) ?? 1) * Math.min(count, 3) * queryCount;
      if (lower.includes(token)) score += field.weight * 0.35;
    }
  }
  const normalizedId = skill.id.toLocaleLowerCase().replace(/-/g, ' ');
  const lowerQuery = query.toLocaleLowerCase();
  if (lowerQuery.includes(skill.id.toLocaleLowerCase()) || lowerQuery.includes(normalizedId)) {
    score += 18;
  }
  if (skill.disabled) score *= 0.05;
  if (skill.healthIssues?.some((issue) => issue.severity === 'error')) score *= 0.65;
  return score;
}

function buildIdf(skills: CatalogSkill[]): Map<string, number> {
  const documentFrequency = new Map<string, number>();
  for (const skill of skills) {
    const tokens = new Set(fields(skill).flatMap((field) => tokenize(field.value)));
    for (const token of tokens) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  return new Map(
    Array.from(documentFrequency, ([token, count]) => [
      token,
      Math.log((skills.length + 1) / (count + 1)) + 1,
    ])
  );
}

export function routeSkills(args: {
  query: string;
  skills: CatalogSkill[];
  allowedSkillKeys?: ReadonlySet<string>;
  limit?: number;
}): SkillRouteSuggestion[] {
  const candidates = args.skills.filter(
    (skill) =>
      skill.installed &&
      !skill.disabled &&
      (!args.allowedSkillKeys ||
        args.allowedSkillKeys.has(skill.key) ||
        args.allowedSkillKeys.has(skill.id))
  );
  if (!args.query.trim() || candidates.length === 0) return [];
  const idf = buildIdf(candidates);
  const ranked = candidates
    .map((skill) => ({ skill, score: candidateScore(skill, args.query, idf) }))
    .filter((candidate) => candidate.score >= 2.5)
    .sort(
      (left, right) => right.score - left.score || left.skill.key.localeCompare(right.skill.key)
    );
  const topScore = ranked[0]?.score ?? 0;
  const secondScore = ranked[1]?.score ?? 0;
  const margin = topScore - secondScore;
  return ranked.slice(0, args.limit ?? 8).map(({ skill, score }, index) => {
    const confidence =
      index === 0 && score >= 14 && margin >= 3 ? 'high' : score >= 6 ? 'medium' : 'low';
    const matched = Array.from(
      new Set(
        tokenize(args.query).filter((token) =>
          fields(skill).some((field) => tokenize(field.value).includes(token))
        )
      )
    ).slice(0, 3);
    return {
      skillKey: skill.key,
      skillId: skill.id,
      displayName: skill.displayName,
      score: Math.round(score * 100) / 100,
      confidence,
      reason:
        matched.length > 0 ? `Matches ${matched.join(', ')}` : 'Matches the requested workflow',
    };
  });
}
