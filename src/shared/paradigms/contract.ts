import type { z } from 'zod';

/**
 * Development paradigms — the plugin contract.
 *
 * A paradigm answers one question: "given a user requirement, how is a task
 * driven to completion?" Vibe coding hands it to a single Agent; the review
 * loop alternates implementer and reviewer; a team fans it out over a roster.
 *
 * Two axes, deliberately separate:
 *
 * - **Kind** (this file) — code. A kind is the protocol implementation: which
 *   Agent slots it exposes, what it needs from the environment, how it
 *   launches, what it contributes to the task canvas. Fixed at build time,
 *   mounted in a registry. Adding a paradigm = one directory + one registry
 *   line, no edits to the composer's branch points.
 * - **Instance** (`paradigm.ts`) — data. A row the user can rename, re-icon,
 *   duplicate, and parameterize. Many instances may share one kind; that is
 *   already how every Agent Team gets its own picker entry.
 *
 * This module is imported by main, renderer, and mobile, so it stays pure data:
 * no React, no lucide. Icons are string ids resolved to components on the
 * renderer side.
 */

export const PARADIGM_KIND_IDS = [
  'single',
  'spec',
  'review',
  'app-build',
  'team',
  'compare',
] as const;

export type ParadigmKindId = (typeof PARADIGM_KIND_IDS)[number];

export function isParadigmKindId(value: unknown): value is ParadigmKindId {
  return typeof value === 'string' && (PARADIGM_KIND_IDS as readonly string[]).includes(value);
}

/**
 * Icon ids a paradigm (or one of its slots) may declare. Resolved to lucide
 * components by the renderer's icon map — shared code must not import React.
 */
export const PARADIGM_ICON_IDS = [
  'bot',
  'lightbulb',
  'repeat',
  'app-window',
  'git-fork',
  'columns',
  'shield-check',
  'users',
] as const;

export type ParadigmIconId = (typeof PARADIGM_ICON_IDS)[number];

/**
 * One Agent seat a paradigm exposes in its configuration panel.
 *
 * `key` is the seat's role inside the kind and is stable forever. `storageKey`
 * is where the user's pick is persisted — currently the legacy per-mode prompt
 * key (`'review:implementer'`), kept verbatim so existing drafts keep resolving
 * until the paradigm-params migration moves them.
 */
export interface ParadigmSlot {
  key: string;
  storageKey: string;
  labelKey: string;
  iconId: ParadigmIconId;
  /** Built-in Agent preset used when the user has not picked one. */
  defaultBuiltinAgentKey: string;
  /**
   * Which runtime the seat falls back to when its Agent declares no preference:
   * the composer's own runtime, or the separately configured reviewer runtime.
   */
  runtimeFallback: 'composer' | 'reviewer';
}

/** How a paradigm's worktree/branch requirement is decided. */
export type ParadigmWorktreeNeed = 'required' | 'optional' | 'never';

/**
 * Which persisted strategy setting an `optional`-worktree paradigm reads.
 * `null` for paradigms whose worktree need is fixed.
 */
export type ParadigmStrategyField = 'standard' | 'review' | null;

/**
 * What happens when the project has no commits yet ("unborn" HEAD).
 * `degrade` silently runs without a worktree; `seed-commit` asks the user to
 * create the first commit because the paradigm cannot work without a branch.
 */
export type ParadigmUnbornPolicy = 'degrade' | 'seed-commit';

/** Visual weight of the composer input while the paradigm is selected. */
export type ParadigmAccent = 'default' | 'advanced' | 'experimental';

/**
 * Which section of the paradigm picker a kind's entries land in. `null` keeps a
 * kind out of the picker — `compare` is reached through the composer's own
 * "compare" affordance instead of being chosen as a paradigm.
 */
export type ParadigmPickerGroup = 'workflow' | 'multi-agent';

/**
 * Where a kind's instances come from. `null` means the kind has exactly one
 * implicit instance; `'agent-teams'` means each Agent Team is an instance, so the
 * kind contributes one picker entry per team and none when there are no teams.
 */
export type ParadigmInstanceSource = 'agent-teams' | null;

export interface ParadigmCapabilities {
  worktree: ParadigmWorktreeNeed;
  strategyField: ParadigmStrategyField;
  unbornPolicy: ParadigmUnbornPolicy;
  /** Can run with no project selected (falls back to the Drafts workspace). */
  projectless: boolean;
  /** Can be launched into an already-open task instead of creating a new one. */
  taskScoped: boolean;
  /** `new-project` paradigms scaffold their own project instead of using one. */
  target: 'task' | 'new-project';
  accent: ParadigmAccent;
  /** Offered by the mobile composer. */
  mobile: boolean;
  /** May be wrapped by a composing paradigm such as `compare`. */
  composable: boolean;
}

export interface ParadigmKindDescriptor<Params = unknown> {
  kindId: ParadigmKindId;
  /** i18n key for the kind's own name, used when an instance has no label. */
  labelKey: string;
  descriptionKey: string;
  iconId: ParadigmIconId;
  /** Picker section, or null for kinds reached through another affordance. */
  pickerGroup: ParadigmPickerGroup | null;
  /** Rank inside the picker group. Instances may override it. */
  pickerOrder: number;
  /** Where the kind's instances come from; null = one implicit instance. */
  instanceSource: ParadigmInstanceSource;
  slots: readonly ParadigmSlot[];
  capabilities: ParadigmCapabilities;
  paramsSchema: z.ZodType<Params>;
  defaultParams: Params;
  /** Surfaced behind the experimental affordance in the picker. */
  alpha?: boolean;
}
