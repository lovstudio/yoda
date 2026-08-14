import { BUILTIN_AGENT_KEYS } from '../builtin-agents';
import { DEFAULT_TEAM_COMMUNICATION_CONFIG } from '../team-communication';
import { DEFAULT_ROUTING_HOP_LIMIT } from '../team-routing-limit';
import {
  PARADIGM_KIND_IDS,
  type ParadigmKindDescriptor,
  type ParadigmKindId,
  type ParadigmSlot,
  type ParadigmTaskMarker,
} from './contract';
import { builtinParadigmId } from './paradigm';
import {
  appBuildParadigmParamsSchema,
  compareParadigmParamsSchema,
  reviewParadigmParamsSchema,
  singleParadigmParamsSchema,
  specParadigmParamsSchema,
  teamParadigmParamsSchema,
} from './params';

/**
 * The built-in paradigm kinds.
 *
 * Every branch point that used to switch on the composer's `runMode` string
 * reads a field here instead. Adding a kind means adding a descriptor and a
 * launcher — not touching the composer.
 *
 * `storageKey`s are the legacy per-mode prompt keys. They stay verbatim so
 * existing composer drafts (`homeDraft.selectedAgentIds`) keep resolving; the
 * paradigm-params migration renames them later.
 */

export const singleParadigmKind: ParadigmKindDescriptor = {
  kindId: 'single',
  labelKey: 'home.modeNormal',
  descriptionKey: 'home.modeNormalDesc',
  iconId: 'bot',
  pickerGroup: 'workflow',
  pickerOrder: 0,
  instanceSource: null,
  slots: [
    {
      key: 'agent',
      storageKey: 'normal:agent',
      labelKey: 'home.agentLabel',
      iconId: 'bot',
      defaultBuiltinAgentKey: BUILTIN_AGENT_KEYS.general,
      runtimeFallback: 'composer',
    },
  ],
  taskMarker: 'default',
  capabilities: {
    worktree: 'optional',
    strategyField: 'standard',
    unbornPolicy: 'degrade',
    projectless: true,
    taskScoped: true,
    target: 'task',
    accent: 'default',
    mobile: true,
    composable: true,
  },
  paramsSchema: singleParadigmParamsSchema,
  defaultParams: singleParadigmParamsSchema.parse({}),
};

export const specParadigmKind: ParadigmKindDescriptor = {
  kindId: 'spec',
  labelKey: 'home.modeBrainstorm',
  descriptionKey: 'home.modeBrainstormDesc',
  iconId: 'lightbulb',
  pickerGroup: 'workflow',
  pickerOrder: 40,
  instanceSource: null,
  slots: [
    {
      key: 'agent',
      storageKey: 'brainstorm:agent',
      labelKey: 'home.brainstormAgent',
      iconId: 'lightbulb',
      defaultBuiltinAgentKey: BUILTIN_AGENT_KEYS.spec,
      runtimeFallback: 'composer',
    },
  ],
  taskMarker: 'default',
  capabilities: {
    // Spec work reads and writes the repo in place — no branch is cut for it.
    worktree: 'never',
    strategyField: null,
    unbornPolicy: 'degrade',
    projectless: true,
    taskScoped: true,
    target: 'task',
    accent: 'advanced',
    mobile: true,
    composable: true,
  },
  paramsSchema: specParadigmParamsSchema,
  defaultParams: specParadigmParamsSchema.parse({}),
  alpha: true,
};

export const reviewParadigmKind: ParadigmKindDescriptor = {
  kindId: 'review',
  labelKey: 'home.modeReview',
  descriptionKey: 'home.modeReviewDesc',
  iconId: 'repeat',
  pickerGroup: 'workflow',
  pickerOrder: 30,
  instanceSource: null,
  slots: [
    {
      key: 'implementer',
      storageKey: 'review:implementer',
      labelKey: 'home.reviewImplementer',
      iconId: 'bot',
      defaultBuiltinAgentKey: BUILTIN_AGENT_KEYS.reviewImplementer,
      runtimeFallback: 'composer',
    },
    {
      key: 'reviewer',
      storageKey: 'review:reviewer',
      labelKey: 'home.reviewReviewer',
      iconId: 'shield-check',
      defaultBuiltinAgentKey: BUILTIN_AGENT_KEYS.reviewReviewer,
      runtimeFallback: 'reviewer',
    },
  ],
  // Two Agents, but only one seat is user-facing and the loop reads as a single
  // thread of work — the multi-agent marker is reserved for a visible roster.
  taskMarker: 'default',
  capabilities: {
    worktree: 'optional',
    strategyField: 'review',
    // The loop needs a branch to review, so an unborn repo is a hard stop.
    unbornPolicy: 'seed-commit',
    projectless: false,
    taskScoped: true,
    target: 'task',
    accent: 'advanced',
    mobile: false,
    composable: true,
  },
  paramsSchema: reviewParadigmParamsSchema,
  defaultParams: reviewParadigmParamsSchema.parse({}),
};

export const appBuildParadigmKind: ParadigmKindDescriptor = {
  kindId: 'app-build',
  labelKey: 'home.modeBuild',
  descriptionKey: 'home.modeBuildDesc',
  iconId: 'app-window',
  pickerGroup: 'workflow',
  pickerOrder: 20,
  instanceSource: null,
  slots: [
    {
      key: 'agent',
      storageKey: 'build:agent',
      labelKey: 'home.buildAgent',
      iconId: 'app-window',
      defaultBuiltinAgentKey: BUILTIN_AGENT_KEYS.general,
      runtimeFallback: 'composer',
    },
  ],
  taskMarker: 'default',
  capabilities: {
    worktree: 'never',
    strategyField: null,
    unbornPolicy: 'degrade',
    projectless: true,
    // Scaffolds its own project, so there is no existing task to join.
    taskScoped: false,
    target: 'new-project',
    accent: 'experimental',
    mobile: false,
    composable: false,
  },
  paramsSchema: appBuildParadigmParamsSchema,
  defaultParams: appBuildParadigmParamsSchema.parse({}),
  alpha: true,
};

export const teamParadigmKind: ParadigmKindDescriptor = {
  kindId: 'team',
  labelKey: 'home.modeTeamDefault',
  descriptionKey: 'home.modeTeamDesc',
  iconId: 'git-fork',
  pickerGroup: 'multi-agent',
  pickerOrder: 0,
  instanceSource: 'agent-teams',
  // The roster lives in params (one instance per Agent Team), not in fixed slots.
  slots: [],
  taskMarker: 'multi-agent',
  capabilities: {
    worktree: 'required',
    strategyField: null,
    unbornPolicy: 'seed-commit',
    projectless: false,
    taskScoped: true,
    target: 'task',
    accent: 'advanced',
    mobile: false,
    composable: true,
  },
  paramsSchema: teamParadigmParamsSchema,
  defaultParams: {
    agents: {},
    routing: 'sequential',
    communication: { ...DEFAULT_TEAM_COMMUNICATION_CONFIG },
    routingHopLimit: DEFAULT_ROUTING_HOP_LIMIT,
    members: [],
  },
};

export const compareParadigmKind: ParadigmKindDescriptor = {
  kindId: 'compare',
  labelKey: 'home.modeCompare',
  descriptionKey: 'home.modeCompareDesc',
  iconId: 'columns',
  pickerGroup: null,
  pickerOrder: 0,
  instanceSource: null,
  slots: [],
  // Each variant task is stamped with the inner paradigm, so the marker a
  // comparison produces is the inner kind's, never this one's.
  taskMarker: 'default',
  capabilities: {
    worktree: 'optional',
    strategyField: 'standard',
    unbornPolicy: 'degrade',
    projectless: false,
    taskScoped: false,
    target: 'task',
    accent: 'default',
    mobile: false,
    composable: false,
  },
  paramsSchema: compareParadigmParamsSchema,
  defaultParams: {
    agents: {},
    inner: { kindId: 'single', paradigmId: builtinParadigmId('single') },
    variants: [],
  },
};

export const PARADIGM_KINDS: Record<ParadigmKindId, ParadigmKindDescriptor> = {
  single: singleParadigmKind,
  spec: specParadigmKind,
  review: reviewParadigmKind,
  'app-build': appBuildParadigmKind,
  team: teamParadigmKind,
  compare: compareParadigmKind,
};

export function paradigmKind(kindId: ParadigmKindId): ParadigmKindDescriptor {
  return PARADIGM_KINDS[kindId];
}

/** A kind's slot by role, e.g. `paradigmSlot('review', 'reviewer')`. */
export function paradigmSlot(kindId: ParadigmKindId, slotKey: string): ParadigmSlot {
  const slot = PARADIGM_KINDS[kindId].slots.find((candidate) => candidate.key === slotKey);
  if (!slot) throw new Error(`Paradigm kind "${kindId}" has no "${slotKey}" slot`);
  return slot;
}

/**
 * How a task's list rows should be marked, from the paradigm recorded on it.
 *
 * Unknown or absent kinds fall back to `default`: a task stamped by a build this
 * one does not know about is still a task, and a row is the wrong place to fail.
 */
export function paradigmTaskMarker(kindId: ParadigmKindId | undefined): ParadigmTaskMarker {
  if (!kindId) return 'default';
  return PARADIGM_KINDS[kindId]?.taskMarker ?? 'default';
}

/** Kinds in picker order: converged workflows first, then multi-agent. */
export const PARADIGM_KIND_ORDER: readonly ParadigmKindId[] = PARADIGM_KIND_IDS;

/**
 * The composer's persisted `runMode` values, kept as-is on disk. The paradigm
 * kind ids are the new vocabulary; this maps between them so settings written by
 * older versions keep loading.
 */
export const LEGACY_RUN_MODES = ['normal', 'build', 'brainstorm', 'review', 'team'] as const;

export type LegacyRunMode = (typeof LEGACY_RUN_MODES)[number];

const LEGACY_RUN_MODE_TO_KIND: Record<LegacyRunMode, ParadigmKindId> = {
  normal: 'single',
  build: 'app-build',
  brainstorm: 'spec',
  review: 'review',
  team: 'team',
};

const KIND_TO_LEGACY_RUN_MODE: Partial<Record<ParadigmKindId, LegacyRunMode>> = {
  single: 'normal',
  'app-build': 'build',
  spec: 'brainstorm',
  review: 'review',
  team: 'team',
};

export function paradigmKindForRunMode(runMode: LegacyRunMode): ParadigmKindId {
  return LEGACY_RUN_MODE_TO_KIND[runMode];
}

/** null for kinds with no legacy equivalent (`compare` came back as a kind). */
export function runModeForParadigmKind(kindId: ParadigmKindId): LegacyRunMode | null {
  return KIND_TO_LEGACY_RUN_MODE[kindId] ?? null;
}

/** Every slot across every kind — used to validate persisted slot selections. */
export function paradigmSlotByStorageKey(storageKey: string) {
  for (const kindId of PARADIGM_KIND_IDS) {
    const slot = PARADIGM_KINDS[kindId].slots.find((s) => s.storageKey === storageKey);
    if (slot) return slot;
  }
  return undefined;
}
