/**
 * Structural types for the cordis services this plugin consumes, plus the
 * Context augmentation both halves share.
 *
 * A third-party plugin resolves outside DSH's own cordis instance, so the
 * upstream `declare module 'cordis'` augmentations never reach this Context —
 * and the public npm `cordis` package does not declare the DSH-vendored
 * runtime members (`ctx.effect`, service properties). The faces below restate
 * the runtime shapes this plugin actually touches, so drift from upstream is
 * contained to this one file:
 * - slots: the client runtime SlotRegistry (`register`, `inject`)
 * - workspaces: the runtime IWorkspaces (`openPath`)
 * - locale: @deepseek-ai/dsh-client-locale's LocaleRuntime
 * - effect: the DSH-vendored cordis lifecycle helper
 *
 * The file must stay free of Node types: it is part of the client-reachable
 * declaration graph, and a `node:` import here would leak into a browser-only
 * consumer build.
 */
import type { RuntimeBarRegistry } from '@yoda/runtime-bar/registry';
import type { Context } from 'cordis';

/** Options passed to `ctx.slots.register` (the subset this plugin uses). */
export interface BarSlotRegisterOptions {
  name: string;
  id?: string;
  order?: number;
  label?: string | (() => string);
  /** Business-face factory; its arguments depend on the slot's scope. */
  inject?: (...args: never[]) => Record<string, unknown>;
}

/** The client slots service face (`register` returns the disposer). */
export interface BarSlotsService {
  register(options: BarSlotRegisterOptions, component: unknown): () => void;
  /**
   * Run a callback for each declaration lifetime of a slot: a no-op while the
   * slot is undeclared, which is what lets this plugin register into the
   * composer dock without racing the conversation shell that declares it.
   */
  inject(key: string, callback: () => () => void): () => void;
}

/**
 * One session row as the client list feed publishes it (structural mirror of
 * the runtime `SessionSummary` — only the fields the bar entries read).
 */
export interface BarSessionSummary {
  id: string;
  /** Durable title, project basename, then session id — always present. */
  displayTitle: string;
  cwd?: string;
  /** Whether this session's agent is currently running. */
  running: boolean;
  /** A user interaction is blocking the session (the amber-dot state). */
  pendingInteraction?: { kind?: string } | string;
  /** Finished while not selected and not yet opened. */
  completed?: boolean;
  /** Coarse durable origin; present on subagent children. */
  origin?: 'subagent';
}

/** Lifecycle status of one background job (closed wire union). */
export type BarJobStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed';

/** One background job as the client mirror sees it. */
export interface BarJobView {
  id: string;
  /** Producer kind (`bash`, `subagent`, …; open string by design). */
  kind: string;
  label: string;
  status: BarJobStatus;
}

/** The session list snapshot the bar reads. */
export interface BarSessionList {
  /** Host list order. */
  ids: readonly string[];
  byId: Readonly<Record<string, BarSessionSummary>>;
  current: string | undefined;
  /**
   * Background jobs per session (a missing key is an empty set). Absent on
   * runtimes older than the jobs mirror — the jobs entry then shows nothing
   * rather than guessing.
   */
  jobsBySession?: Readonly<Record<string, readonly BarJobView[]>>;
}

/**
 * A framework selector hook over a snapshot source. Session-scope slot
 * components receive one of these per subject; the bar passes their selected
 * values down through React context so its entries stay prop-free.
 */
export type BarSelectorHook<T> = <S>(select: (state: T) => S, equal?: (a: S, b: S) => boolean) => S;

/**
 * The client workspaces service face: `openPath` hands an absolute path to the
 * Host operating system's default application.
 */
export interface BarWorkspacesService {
  openPath(path: string): Promise<void>;
}

/**
 * The client locale service face (mirror of LocaleRuntime): the active locale
 * is the Host-backed preference rather than the raw browser language, and this
 * plugin's dictionaries register into its namespace registry.
 */
export interface BarLocaleService {
  /** Current immutable snapshot; `active` is 'zh' | 'en' today. */
  getSnapshot(): { active: string };
  /** Subscribe to locale switches and dictionary registrations. */
  subscribe(fn: () => void): () => void;
  /** Register one locale's dictionary for a namespace; returns the disposer. */
  register(ns: string, locale: string, dict: Record<string, string>): () => void;
}

declare module 'cordis' {
  interface Context {
    slots: BarSlotsService;
    workspaces: BarWorkspacesService;
    locale: BarLocaleService;
    /**
     * The bar's entry registry: other plugins add their own entries through
     * `ctx.yodaRuntimeBar.register({ id, slot, order, Component })`. Provided
     * by the client half; undefined on the host side.
     */
    yodaRuntimeBar: RuntimeBarRegistry;
    /**
     * Register a lifecycle callback (DSH-vendored cordis): runs at plugin
     * activation, and its returned cleanup runs at disposal.
     */
    effect(fn: () => void | (() => void), label?: string): void;
  }
}

/*
 * No second augmentation of the DSH-vendored `@deepseek-ai/cordis` scope: this
 * package ships no declarations, so the augmentation would only ever apply to
 * its own sources — and those import `Context` from `cordis`. A consumer that
 * wants the typed service face restates it the same way this file does.
 */

export type { Context };
