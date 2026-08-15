import { z } from 'zod';
import {
  normalizeTeamMembers,
  normalizeTeamRouting,
  TEAM_ROUTINGS,
  type AgentTeamMember,
} from '../agent-team';
import { runtimeIdSchema } from '../runtime-id-schema';
import {
  normalizeTeamCommunicationConfig,
  TEAM_COMMUNICATION_MODES,
  type TeamCommunicationConfig,
} from '../team-communication';
import { normalizeRoutingHopLimit } from '../team-routing-limit';
import { PARADIGM_KIND_IDS } from './contract';

/**
 * Per-kind parameter schemas.
 *
 * Params are the paradigm *instance's* configuration — the part a user edits,
 * duplicates, and carries into a task. Everything a kind needs to launch that
 * is not ambient environment state belongs here, so that duplicating a paradigm
 * duplicates its behavior and a task can snapshot exactly how it was launched.
 */

/**
 * Agent picked per slot, keyed by `ParadigmSlot.storageKey`. The array shape is
 * inherited from the composer draft, where a slot may hold several Agents whose
 * system prompts are concatenated.
 */
export const paradigmSlotAgentsSchema = z.record(z.string(), z.array(z.string()));

export type ParadigmSlotAgents = z.infer<typeof paradigmSlotAgentsSchema>;

const paradigmAgentsCarrier = z.object({ agents: paradigmSlotAgentsSchema.default({}) });

/**
 * The seat assignments any kind's params carry.
 *
 * Every schema here is built on `withSlots`, so `agents` is the one field
 * readable without knowing the kind — which is what lets a duplicated paradigm
 * carry its own Agents instead of sharing one set per kind. Unreadable params
 * yield no assignments rather than throwing: an unassigned seat falls back to its
 * default, which is what an unconfigured instance does anyway.
 */
export function paradigmParamsAgents(params: unknown): ParadigmSlotAgents {
  const parsed = paradigmAgentsCarrier.safeParse(params);
  return parsed.success ? parsed.data.agents : {};
}

/** The same params with one seat reassigned; every other field is left alone. */
export function withParadigmSlotAgent(
  params: unknown,
  slotStorageKey: string,
  agentId: string
): unknown {
  const base = params && typeof params === 'object' ? (params as Record<string, unknown>) : {};
  return {
    ...base,
    agents: { ...paradigmParamsAgents(params), [slotStorageKey]: [agentId] },
  };
}

const withSlots = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ agents: paradigmSlotAgentsSchema.default({}), ...shape });

export const singleParadigmParamsSchema = withSlots({});
export type SingleParadigmParams = z.infer<typeof singleParadigmParamsSchema>;

const teamMemberSchema = z.object({
  handle: z.string(),
  displayName: z.string(),
  icon: z.string().optional(),
  role: z.enum(['leader', 'worker']),
  runtime: runtimeIdSchema,
  agentRef: z.string().optional(),
  systemPrompt: z.string().optional(),
});

const teamCommunicationSchema = z.object({
  mode: z.enum(TEAM_COMMUNICATION_MODES),
  syncToRoom: z.boolean(),
  sharedFilePath: z.string(),
  githubRepository: z.string(),
  githubIssueNumber: z.number().nullable(),
  githubPullRequestNumber: z.number().nullable(),
});

/**
 * Team params repair rather than reject.
 *
 * A team is the one paradigm whose params carry irreplaceable user data — the
 * roster. A strict schema would turn a single unreadable field (a runtime that
 * has since been removed, say) into a failed parse, and a failed parse falls
 * back to the kind's defaults, whose roster is empty. Normalizing first means the
 * worst case is a repaired member, not a deleted team.
 *
 * These are the same normalizers `agentTeamsService` has always applied on read,
 * lifted so both write paths share them.
 */
export const teamParadigmParamsSchema = withSlots({
  routing: z.preprocess(normalizeTeamRouting, z.enum(TEAM_ROUTINGS)),
  communication: z.preprocess(
    (value) => normalizeTeamCommunicationConfig(value as Partial<TeamCommunicationConfig> | null),
    teamCommunicationSchema
  ),
  /** Max conductor routing deliveries per human prompt. null = unlimited. */
  routingHopLimit: z.preprocess(normalizeRoutingHopLimit, z.number().nullable()),
  members: z.preprocess(
    (value) => normalizeTeamMembers(Array.isArray(value) ? (value as AgentTeamMember[]) : []),
    z.array(teamMemberSchema)
  ),
});
export type TeamParadigmParams = z.infer<typeof teamParadigmParamsSchema>;

/**
 * `compare` composes rather than reimplements: it wraps another paradigm and
 * runs it once per variant. Keeping the inner paradigm as a reference is what
 * stops this kind from drifting into a near-duplicate of `single` — which is
 * exactly why the original `compare` run mode had to be retired.
 */
export const compareParadigmParamsSchema = withSlots({
  inner: z.object({
    kindId: z.enum(PARADIGM_KIND_IDS),
    paradigmId: z.string(),
  }),
  variants: z.array(
    z.object({
      id: z.string(),
      projectId: z.string().nullable(),
      runtimeId: runtimeIdSchema.nullable(),
      strategyKind: z.enum(['new-branch', 'no-worktree']).nullable(),
      baseBranch: z.string().nullable(),
    })
  ),
});
export type CompareParadigmParams = z.infer<typeof compareParadigmParamsSchema>;
