import type { QueryClient } from '@tanstack/react-query';
import type { AgentTeam } from '@shared/agent-team';
import type { Branch } from '@shared/git';
import type { ParadigmKindDescriptor } from '@shared/paradigms/contract';
import type { ParadigmStamp } from '@shared/paradigms/stamp';
import type { RuntimeId } from '@shared/runtime-registry';
import type { QuickActionTaskSource } from '@shared/tasks';
import type { ResolvedAgentSlot } from '@renderer/app/agent-slot-resolution';
import type { HomeProjectSubmitStrategy } from '@renderer/app/home-project-submit';

/** The persisted branch strategy a task is created with. */
export type TaskStrategyKind = 'new-branch' | 'no-worktree';

/**
 * One extra run environment in a multi-config comparison. Each variant is a copy
 * of the base composer config the user can tweak: a different project, runtime,
 * or branch strategy. On submit every variant spawns its own task and a detached
 * window tiles them side by side.
 */
export interface CompareVariant {
  id: string;
  projectId: string | null;
  runtimeId: RuntimeId | null;
  strategyKind: TaskStrategyKind;
  /** Selected starting branch; null = the project's default branch. */
  baseBranch: Branch | null;
}

/**
 * Where a launch lands. The three task-bearing targets are what let a paradigm
 * have one implementation instead of one per surface: the context absorbs the
 * difference between creating a task and joining one.
 */
export type ParadigmLaunchTarget =
  | { kind: 'existing-task'; projectId: string; taskId: string }
  | { kind: 'new-task'; projectId: string }
  /** No project selected — the task lands in the internal drafts project. */
  | { kind: 'draft' }
  /** The paradigm scaffolds its own project. */
  | { kind: 'new-project' };

/** A slot whose Agent resolved to a runtime, so it can actually be launched. */
export type LaunchableSlot = ResolvedAgentSlot & { provider: RuntimeId };

export interface ParadigmAgentLaunchRequest {
  slot: LaunchableSlot;
  /**
   * Builds the agent's initial prompt. Called again with the rewritten text when
   * the prompt is deferred for translation, so a paradigm states its prompt
   * shape exactly once.
   */
  buildPrompt: (requirement: string) => string | undefined;
  /** Task name seed; defaults to `ctx.baseName`. Ignored for `existing-task`. */
  nameSeed?: string;
  quickActionSource?: Omit<QuickActionTaskSource, 'conversationId'>;
}

export interface LaunchedParadigmAgent {
  projectId: string;
  taskId: string;
  conversationId: string;
  runtime: RuntimeId;
  /** Resolves once the task/conversation exists in the main process. */
  promise: Promise<unknown>;
}

export interface ParadigmVariantLaunchRequest {
  projectId: string;
  slot: LaunchableSlot;
  buildPrompt: (requirement: string) => string | undefined;
  strategyKind: TaskStrategyKind;
  baseBranch: Branch | null;
  nameSeed: string;
  /**
   * Recorded on the variant's task. A variant runs the paradigm under comparison,
   * so this is the inner paradigm's stamp — not the comparison's.
   */
  paradigm: ParadigmStamp;
}

/**
 * The composer's per-paradigm parameters. Every field belongs to exactly one
 * kind, which reads it in its own launcher — nothing here is branched on by the
 * composer. Once paradigm instances are persisted these come from the instance
 * row instead of composer state.
 */
export interface ParadigmLaunchParams {
  /** team: the selected Agent Team template. */
  team: AgentTeam | undefined;
  /** compare: the configs to run side by side. */
  variants: readonly CompareVariant[];
  /** single: records that the prompt came from a quick action. */
  quickAction: boolean;
}

/**
 * Everything a paradigm needs to turn a requirement into running work, with the
 * target-specific plumbing already resolved. A launcher never reads composer
 * state and never navigates on its own.
 */
export interface ParadigmLaunchContext {
  target: ParadigmLaunchTarget;
  /** Raw requirement text, before any language rewrite. */
  requirement: string;
  /** Trimmed prompt text used to seed conversation titles. */
  titlePrompt: string | undefined;
  /** True when the initial prompt is injected after a language rewrite. */
  deferInitialPrompt: boolean;
  /** Unique-per-project task name seed. Empty for `existing-task`. */
  baseName: string;
  imagePaths: string[] | undefined;
  /** The branch strategy this paradigm submits, derived from its capabilities. */
  strategyKind: HomeProjectSubmitStrategy;
  t: (key: string) => string;
  /** For launchers that seed React Query caches after an orchestration starts. */
  queryClient: QueryClient;
  /** Whether the runtime's selected permission tier auto-approves. */
  isAutoApproving(runtime: RuntimeId): boolean;

  /**
   * Resolves a slot's Agent. The slot's own runtime wins; the fallback only
   * applies to Agents configured to follow the composer default, and defaults to
   * the composer's runtime when not named.
   */
  resolveSlot(slotKey: string, fallbackRuntime?: RuntimeId | null): ResolvedAgentSlot;

  /** Creates the agent seat: a conversation on the target task, or a new task. */
  launchAgent(request: ParadigmAgentLaunchRequest): LaunchedParadigmAgent;
  /**
   * A task with no conversation, for paradigms that populate its conversations
   * themselves. Resolves to the existing task when one is targeted.
   */
  launchBareTask(request?: { nameSeed?: string }): {
    projectId: string;
    taskId: string;
    promise: Promise<unknown>;
  };
  /** Spawns one comparison variant, possibly in another project. */
  launchVariant(request: ParadigmVariantLaunchRequest): Promise<LaunchedParadigmAgent | null>;

  /** The requirement to launch with; null when a deferred rewrite failed. */
  resolveRequirement(): Promise<string | null>;
  /** Injects the rewritten prompt once the agent exists. No-op when not deferred. */
  scheduleDeferredPrompt(
    launch: LaunchedParadigmAgent,
    buildPrompt: (requirement: string) => string | undefined
  ): void;
  /**
   * The requirement to seed follow-on orchestration with, once the agent exists.
   * Injects the rewritten prompt first when deferred; null when that failed.
   */
  requirementForOrchestration(
    launch: LaunchedParadigmAgent,
    buildPrompt: (requirement: string) => string | undefined
  ): Promise<string | null>;

  /**
   * Records this paradigm as the one now driving the task being joined. No-op for
   * the targets that create their own task — those are stamped at creation.
   *
   * Opt-in per kind rather than automatic: adding a lone Agent session to a team's
   * task does not stop a team from driving it, so only the kinds that establish an
   * orchestration of their own claim the task.
   */
  claimJoinedTask(): void;
  /** Throws when the task is not provisioned far enough to orchestrate on. */
  assertTaskReady(task: { projectId: string; taskId: string }): void;
  /** Reveals the task. No-op when the composer already sits inside it. */
  focusTask(projectId: string, taskId: string): void;
  /** Clears the composer and reports what was started to its host. */
  finish(): void;
  /** Toasts when a single launch fails, in the target's wording. */
  reportLaunchFailure(promise: Promise<unknown>): void;
  reportFailures(results: PromiseSettledResult<unknown>[]): void;
}

/**
 * A paradigm kind's runtime half: the code that turns a requirement into work.
 * Registered in `registry.ts`; adding a kind means adding a launcher, not
 * touching the composer.
 */
export interface ParadigmLauncher {
  descriptor: ParadigmKindDescriptor;
  launch(ctx: ParadigmLaunchContext, params: ParadigmLaunchParams): Promise<void>;
  /**
   * What to record on the tasks this launch creates. Defaults to the kind's own
   * code-defined instance with its default params, which is right for every kind
   * whose configuration is not yet user-editable.
   *
   * A kind states this itself rather than a central helper switching on kind id —
   * that switch is what this refactor exists to delete.
   */
  stamp?(params: ParadigmLaunchParams): ParadigmStamp;
}

/** Narrows a resolved slot to one that can be launched. */
export function launchableSlot(slot: ResolvedAgentSlot): LaunchableSlot | null {
  const provider = slot.provider;
  return provider ? { ...slot, provider } : null;
}
