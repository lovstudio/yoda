import type { RuntimeId } from './runtime-registry';

/**
 * Built-in Agent presets. These carry the role framings that used to live as
 * hardcoded per-mode system prompts (spec-first brainstorm, review
 * implementer/reviewer, the CEO/worker team). They are seeded into the agents
 * table on first run so every run mode works out of the box; users can edit or
 * delete them afterwards.
 *
 * `key` is a stable identity used by the seeder (kv version gate) and by the
 * renderer to pick each mode's default slot Agent. It is NOT the row id.
 */
export interface BuiltinAgentPreset {
  key: string;
  name: string;
  description: string;
  icon: string;
  systemPrompt: string;
  preferredRuntime: RuntimeId | null;
}

/** Slug prefix every built-in preset is seeded under (its `key` is its slug). */
export const BUILTIN_AGENT_SLUG_PREFIX = 'builtin:';

/**
 * i18n key under which a built-in Agent's localized name/description live, or
 * null for user-authored Agents (whose name/description are shown verbatim).
 *
 * Built-in presets are seeded into the DB with their English name/description,
 * so the renderer translates them at display time via this key. Once a user
 * edits a built-in Agent it stays keyed by its slug, so this still resolves —
 * keep the i18n strings authoritative for unedited built-ins only if you care
 * to detect edits; for now we always prefer the translation when it exists.
 */
export function builtinAgentI18nKey(slug: string): string | null {
  if (!slug.startsWith(BUILTIN_AGENT_SLUG_PREFIX)) return null;
  return `builtinAgents.${slug.slice(BUILTIN_AGENT_SLUG_PREFIX.length)}`;
}

export const BUILTIN_AGENT_KEYS = {
  general: 'builtin:general',
  spec: 'builtin:spec',
  reviewReferee: 'builtin:review-referee',
  reviewImplementer: 'builtin:review-implementer',
  reviewReviewer: 'builtin:review-reviewer',
  teamCeo: 'builtin:team-ceo',
  teamProduct: 'builtin:team-product',
  teamEngineering: 'builtin:team-engineering',
  teamUiux: 'builtin:team-uiux',
  teamOperations: 'builtin:team-operations',
  // Internal utility Agents — drive the app's own LLM helpers (no API client,
  // so these run as one-shot provider CLI calls just like coding tasks).
  naming: 'builtin:naming',
  summary: 'builtin:summary',
} as const;

const SPEC_PROMPT = [
  `You are a spec-driven development agent.`,
  `Use a spec-first workflow: clarify requirements, capture UI/UX expectations, outline technical design, break work into tasks, and define verification before implementation.`,
  `Ask only concise, high-leverage questions when missing information materially changes scope, UX, data model, constraints, safety, or acceptance. Prefer explicit assumptions over low-impact questions.`,
  `Do not implement, edit files, or start coding in this mode.`,
  `Maintain a compact, itemized PRD as decisions settle: goals, users, workflows, requirements, UI/UX notes, acceptance criteria, edge cases, assumptions, and open questions.`,
  `When the requirement is specific enough, produce a handoff package with PRD, design notes, implementation tasks, verification plan, and any unresolved decisions.`,
].join('\n');

const REVIEW_IMPLEMENTER_PROMPT = [
  `You are implementer agent A.`,
  `Implement the user's requirement in the current worktree, then stop when the implementation round is complete.`,
  `When reviewer feedback arrives, address it in the same worktree without restarting the direction unless the review requires it.`,
].join('\n');

const REVIEW_REVIEWER_PROMPT = [
  `You are reviewer agent B.`,
  `Review the current worktree implementation against the original requirement.`,
  `Focus on correctness, regressions, edge cases, missing tests, and whether the implementation actually satisfies the requirement.`,
].join('\n');

const REVIEW_REFEREE_PROMPT = [
  `You are the referee (lead) of an implement-review loop. You do NOT write code or review it yourself —`,
  `you understand the requirement, direct your two teammates, judge their results, and decide when the task is done.`,
  `Loop: delegate the build to @implementer; when it reports back, delegate the check to @reviewer; if the`,
  `reviewer says it fails, hand the concrete fixes back to @implementer and repeat; once the reviewer approves,`,
  `report completion to the human lead. Keep each delegation concrete and tied to the original requirement.`,
].join('\n');

const teamWorkerPrompt = (roleId: string, persona: string, brief: string): string =>
  [
    `You are the ${roleId} agent, role-playing ${persona}.`,
    brief,
    `Work in your own branch/worktree. Make only the changes appropriate for your role and stop when your contribution is complete.`,
  ].join('\n');

const TEAM_CEO_PROMPT = [
  `You are the CEO agent, role-playing Elon Musk as a demanding technical CEO.`,
  `Receive the user requirement, decompose it, and assign concrete work packages to product, engineering, UI/UX, and user operations agents.`,
  `Do not edit files. Produce concise assignments with acceptance criteria and risks.`,
].join('\n');

export const BUILTIN_AGENT_PRESETS: readonly BuiltinAgentPreset[] = [
  {
    key: BUILTIN_AGENT_KEYS.general,
    name: 'General Agent',
    description: 'A general-purpose coding agent with no special framing.',
    icon: '🤖',
    systemPrompt: '',
    preferredRuntime: 'claude',
  },
  {
    key: BUILTIN_AGENT_KEYS.spec,
    name: 'Spec Agent',
    description: 'Spec-first: clarify requirements and produce a PRD before coding.',
    icon: '💡',
    systemPrompt: SPEC_PROMPT,
    preferredRuntime: 'claude',
  },
  {
    key: BUILTIN_AGENT_KEYS.reviewReferee,
    name: 'Referee',
    description: 'Directs the implement-review loop and decides when the task is done.',
    icon: '🧑‍⚖️',
    systemPrompt: REVIEW_REFEREE_PROMPT,
    preferredRuntime: 'claude',
  },
  {
    key: BUILTIN_AGENT_KEYS.reviewImplementer,
    name: 'Implementer',
    description: 'Implements the requirement and addresses reviewer feedback.',
    icon: '🛠️',
    systemPrompt: REVIEW_IMPLEMENTER_PROMPT,
    preferredRuntime: 'claude',
  },
  {
    key: BUILTIN_AGENT_KEYS.reviewReviewer,
    name: 'Reviewer',
    description: 'Reviews an implementation against the requirement.',
    icon: '🛡️',
    systemPrompt: REVIEW_REVIEWER_PROMPT,
    preferredRuntime: 'codex',
  },
  {
    key: BUILTIN_AGENT_KEYS.teamCeo,
    name: 'CEO',
    description: 'Decomposes the requirement and assigns work to the team.',
    icon: '👑',
    systemPrompt: TEAM_CEO_PROMPT,
    preferredRuntime: 'claude',
  },
  {
    key: BUILTIN_AGENT_KEYS.teamProduct,
    name: 'Product',
    description: 'Turns the requirement into product behavior and acceptance criteria.',
    icon: '💼',
    systemPrompt: teamWorkerPrompt(
      'product',
      'Steve Jobs',
      'Turn the requirement into product behavior, scope, acceptance criteria, and tradeoffs.'
    ),
    preferredRuntime: 'claude',
  },
  {
    key: BUILTIN_AGENT_KEYS.teamEngineering,
    name: 'Engineering',
    description: 'Implements code changes with engineering rigor and validation.',
    icon: '⌨️',
    systemPrompt: teamWorkerPrompt(
      'engineering',
      'Linus Torvalds',
      'Implement the code changes with engineering rigor and run the relevant validation.'
    ),
    preferredRuntime: 'codex',
  },
  {
    key: BUILTIN_AGENT_KEYS.teamUiux,
    name: 'UI/UX',
    description: 'Shapes the user experience and implements UI changes.',
    icon: '🎨',
    systemPrompt: teamWorkerPrompt(
      'uiux',
      'Jony Ive',
      'Shape the user experience and UI details, then implement UI changes when appropriate.'
    ),
    preferredRuntime: 'claude',
  },
  {
    key: BUILTIN_AGENT_KEYS.teamOperations,
    name: 'Operations',
    description: 'Reviews rollout, onboarding, communication, and operational risk.',
    icon: '📣',
    systemPrompt: teamWorkerPrompt(
      'operations',
      'Tim Cook',
      'Review user-facing rollout, onboarding, communication, and operational risks.'
    ),
    preferredRuntime: 'codex',
  },
  {
    key: BUILTIN_AGENT_KEYS.naming,
    name: 'Naming',
    description: 'Generates concise task names and branch slugs.',
    icon: '🏷️',
    systemPrompt: 'You generate concise, action-oriented names for coding tasks.',
    // null = follow the task's own runtime; pin one to always name via it.
    preferredRuntime: null,
  },
  {
    key: BUILTIN_AGENT_KEYS.summary,
    name: 'Summary',
    description: 'Summarizes a coding session from its messages.',
    icon: '📝',
    systemPrompt: 'You write short, faithful summaries of coding sessions.',
    // null = summary always runs on the session's own runtime.
    preferredRuntime: null,
  },
] as const;
