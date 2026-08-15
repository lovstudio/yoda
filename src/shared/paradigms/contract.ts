import type { z } from 'zod';

/**
 * Development paradigms — the plugin contract.
 *
 * A paradigm answers one question: "given a user requirement, how is a task
 * driven to completion?" Vibe coding hands it to a single Agent; a team fans it
 * out over a roster.
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

export const PARADIGM_KIND_IDS = ['single', 'team', 'compare'] as const;

export type ParadigmKindId = (typeof PARADIGM_KIND_IDS)[number];

export function isParadigmKindId(value: unknown): value is ParadigmKindId {
  return typeof value === 'string' && (PARADIGM_KIND_IDS as readonly string[]).includes(value);
}

/**
 * Icon ids a paradigm (or one of its slots) may declare. Resolved to lucide
 * components by the renderer's icon map — shared code must not import React.
 */
export const PARADIGM_ICON_IDS = ['bot', 'git-fork', 'columns'] as const;

export type ParadigmIconId = (typeof PARADIGM_ICON_IDS)[number];

/**
 * One Agent seat a paradigm exposes in its configuration panel.
 *
 * `key` is the seat's role inside the kind and is stable forever. `storageKey`
 * is where the user's pick is persisted — currently the legacy per-mode prompt
 * key (`'normal:agent'`), kept verbatim so existing drafts keep resolving until
 * the paradigm-params migration moves them.
 */
export interface ParadigmSlot {
  key: string;
  storageKey: string;
  labelKey: string;
  iconId: ParadigmIconId;
  /** Built-in Agent preset used when the user has not picked one. */
  defaultBuiltinAgentKey: string;
}

/** How a paradigm's worktree/branch requirement is decided. */
export type ParadigmWorktreeNeed = 'required' | 'optional' | 'never';

/**
 * Which persisted strategy setting an `optional`-worktree paradigm reads.
 * `null` for paradigms whose worktree need is fixed.
 */
export type ParadigmStrategyField = 'standard' | null;

/**
 * What happens when the project has no commits yet ("unborn" HEAD).
 * `degrade` silently runs without a worktree; `seed-commit` asks the user to
 * create the first commit because the paradigm cannot work without a branch.
 */
export type ParadigmUnbornPolicy = 'degrade' | 'seed-commit';

/** Visual weight of the composer input while the paradigm is selected. */
export type ParadigmAccent = 'default' | 'advanced' | 'experimental';

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

/**
 * How a paradigm's tasks are marked in task lists.
 *
 * A kind declares this instead of the sidebar asking "does a team room exist for
 * this task?" — that reverse-lookup pulled every room in the app just to badge a
 * row, and it could only ever answer for the one kind it knew about.
 */
export type ParadigmTaskMarker = 'default' | 'multi-agent';

export interface ParadigmKindDescriptor<Params = unknown> {
  kindId: ParadigmKindId;
  /** i18n key for the kind's own name, used when an instance has no label. */
  labelKey: string;
  descriptionKey: string;
  iconId: ParadigmIconId;
  /**
   * Offered as a paradigm the user can pick. False for kinds reached through
   * another affordance — `compare` is entered from the composer's own "compare"
   * control, not chosen from the list.
   *
   * There are no picker sections: the list is flat, one row per paradigm, so a
   * kind either appears in it or does not.
   */
  inPicker: boolean;
  /** Rank in the flat picker. Instances may override it. */
  pickerOrder: number;
  /** Where the kind's instances come from; null = one implicit instance. */
  instanceSource: ParadigmInstanceSource;
  slots: readonly ParadigmSlot[];
  /** How tasks driven by this kind are marked in task lists. */
  taskMarker: ParadigmTaskMarker;
  capabilities: ParadigmCapabilities;
  paramsSchema: z.ZodType<Params>;
  defaultParams: Params;
  /** Surfaced behind the experimental affordance in the picker. */
  alpha?: boolean;
}
