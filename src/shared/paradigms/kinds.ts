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
  compareParadigmParamsSchema,
  singleParadigmParamsSchema,
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
  inPicker: true,
  pickerOrder: 0,
  slots: [
    {
      key: 'agent',
      storageKey: 'normal:agent',
      labelKey: 'home.agentLabel',
      iconId: 'bot',
      defaultBuiltinAgentKey: BUILTIN_AGENT_KEYS.general,
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

export const teamParadigmKind: ParadigmKindDescriptor = {
  kindId: 'team',
  labelKey: 'home.modeTeamDefault',
  descriptionKey: 'home.modeTeamDesc',
  iconId: 'git-fork',
  inPicker: true,
  pickerOrder: 50,
  // The roster lives in params (edited in the paradigm's own panel), not in fixed slots.
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
    // Shipped with a roster rather than empty: a way of working the user has to
    // populate before it does anything is not a paradigm, it is a form. These
    // three are the stages every non-trivial change goes through, and any of them
    // can be switched off in the panel — which is cheaper than assembling them.
    members: [
      {
        handle: 'spec',
        displayName: 'Spec Agent',
        role: 'leader' as const,
        runtime: 'claude' as const,
        agentRef: BUILTIN_AGENT_KEYS.spec,
      },
      {
        handle: 'implementer',
        displayName: 'Implementer',
        role: 'worker' as const,
        runtime: 'claude' as const,
        agentRef: BUILTIN_AGENT_KEYS.reviewImplementer,
      },
      {
        handle: 'reviewer',
        displayName: 'Reviewer',
        role: 'worker' as const,
        runtime: 'codex' as const,
        agentRef: BUILTIN_AGENT_KEYS.reviewReviewer,
      },
    ],
  },
};

export const compareParadigmKind: ParadigmKindDescriptor = {
  kindId: 'compare',
  labelKey: 'home.modeCompare',
  descriptionKey: 'home.modeCompareDesc',
  iconId: 'columns',
  inPicker: false,
  pickerOrder: 0,
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
  team: teamParadigmKind,
  compare: compareParadigmKind,
};

export function paradigmKind(kindId: ParadigmKindId): ParadigmKindDescriptor {
  return PARADIGM_KINDS[kindId];
}

/** A kind's slot by role, e.g. `paradigmSlot('single', 'agent')`. */
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
export const LEGACY_RUN_MODES = ['normal', 'team'] as const;

export type LegacyRunMode = (typeof LEGACY_RUN_MODES)[number];

/**
 * Run modes whose paradigms were retired. A draft or `.yoda.json` written when
 * they existed still has to parse, so they coerce to vibe coding rather than
 * failing the whole settings object — the same treatment `compare` got when it
 * stopped being a mode of its own.
 */
const RETIRED_RUN_MODES: readonly string[] = ['compare', 'build', 'brainstorm', 'review'];

/** Coerces a persisted run mode, retired values included, into a live one. */
export function normalizeLegacyRunMode(value: unknown): unknown {
  return typeof value === 'string' && RETIRED_RUN_MODES.includes(value) ? 'normal' : value;
}

const LEGACY_RUN_MODE_TO_KIND: Record<LegacyRunMode, ParadigmKindId> = {
  normal: 'single',
  team: 'team',
};

const KIND_TO_LEGACY_RUN_MODE: Partial<Record<ParadigmKindId, LegacyRunMode>> = {
  single: 'normal',
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
