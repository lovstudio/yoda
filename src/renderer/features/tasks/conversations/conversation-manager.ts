import { action, computed, makeObservable, observable, onBecomeObserved, runInAction } from 'mobx';
import {
  type Conversation,
  type ConversationResumeBlockReason,
  type CreateConversationParams,
  type ForkConversationAtPromptParams,
  type ForkConversationParams,
  type SessionRuntimeOverrides,
} from '@shared/conversations';
import type { PendingAction } from '@shared/events/agent-run-state';
import {
  agentEventChannel,
  agentSessionExitedChannel,
  agentSessionStatusChangedChannel,
  isAgentSessionRunningStatus,
  isAttentionNotification,
  type AgentEvent,
  type AgentSessionExited,
  type AgentSessionRuntimeStatus,
  type NotificationType,
} from '@shared/events/agentEvents';
import {
  conversationArchivedChannel,
  conversationMovedChannel,
  conversationRenamedChannel,
} from '@shared/events/conversationEvents';
import { getAgentNotificationKind } from '@shared/notification-settings';
import { makePtySessionId } from '@shared/ptySessionId';
import type { SessionOpenPerformanceContext } from '@shared/session-open-performance';
import { events, rpc } from '@renderer/lib/ipc';
import { getPaneContainer } from '@renderer/lib/pty/pane-sizing-context';
import type { FrontendPty } from '@renderer/lib/pty/pty';
import {
  getCellMetrics,
  getTerminalFitScrollbarWidth,
  measureDimensions,
  TERMINAL_FIT_GUARD_COLUMNS,
} from '@renderer/lib/pty/pty-dimensions';
import { PtySession } from '@renderer/lib/pty/pty-session';
import { publishAgentRuntimeStatusPreview } from '@renderer/lib/stores/agent-runtime-status-bridge';
import { log } from '@renderer/utils/logger';
import { soundPlayer } from '@renderer/utils/soundPlayer';

export type AgentStatus = AgentSessionRuntimeStatus;

const SOUND_DEDUPE_WINDOW_MS = 3_000;
const STAGING_CANCELLATION_POLL_MS = 25;
const STAGING_REVEAL_CLAIM_TIMEOUT_MS = 250;
const CONVERSATION_SNAPSHOT_LOAD_TIMEOUT_MS = 3_000;
const recentSoundEvents = new Map<string, number>();

class ConversationSnapshotLoadTimeoutError extends Error {
  constructor(projectId: string, taskId: string) {
    super(
      `Conversation snapshot load exceeded ${CONVERSATION_SNAPSHOT_LOAD_TIMEOUT_MS}ms ` +
        `(project=${projectId}, task=${taskId})`
    );
    this.name = 'ConversationSnapshotLoadTimeoutError';
  }
}

type StagingWaitOutcome<T> =
  | { readonly status: 'resolved'; readonly value: T }
  | { readonly status: 'stopped' };

/** Bound an arbitrary IPC step by the task-open deadline and cancellation lease. */
function waitForStagingStep<T>(
  promise: Promise<T>,
  shouldContinue: () => boolean,
  deadline: number
): Promise<StagingWaitOutcome<T>> {
  if (!shouldContinue() || performance.now() >= deadline) {
    return Promise.resolve({ status: 'stopped' });
  }

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const cleanup = () => {
      if (timer !== null) clearTimeout(timer);
    };
    const finish = (outcome: StagingWaitOutcome<T>) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(outcome);
    };
    const poll = () => {
      if (settled) return;
      const remainingMs = deadline - performance.now();
      if (!shouldContinue() || remainingMs <= 0) {
        finish({ status: 'stopped' });
        return;
      }
      timer = setTimeout(poll, Math.min(STAGING_CANCELLATION_POLL_MS, remainingMs));
    };

    promise.then(
      (value) => finish({ status: 'resolved', value }),
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      }
    );
    poll();
  });
}

/** Bound the initial local snapshot RPC; late replies are ignored until an explicit retry. */
function loadConversationSnapshotWithDeadline(
  projectId: string,
  taskId: string
): Promise<Conversation[]> {
  const request = rpc.conversations.getConversationsForTask(projectId, taskId);
  return new Promise<Conversation[]>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new ConversationSnapshotLoadTimeoutError(projectId, taskId));
    }, CONVERSATION_SNAPSHOT_LOAD_TIMEOUT_MS);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    request.then(
      (conversations) => finish(() => resolve(conversations)),
      (error: unknown) => finish(() => reject(error))
    );
  });
}

function getConversationPaneDimensions(
  pty: FrontendPty,
  projectId: string,
  taskId: string
): { cols: number; rows: number } | null {
  const pane = getPaneContainer(`conversations:${projectId}:${taskId}`);
  const cell = getCellMetrics(pty.terminal);
  if (pane && cell) {
    const measured = measureDimensions(
      pane,
      cell.width,
      cell.height,
      getTerminalFitScrollbarWidth(pty.terminal),
      TERMINAL_FIT_GUARD_COLUMNS
    );
    if (measured) return measured;
  }
  return null;
}

async function waitForConversationPaneDimensions(
  pty: FrontendPty,
  projectId: string,
  taskId: string,
  shouldContinue: () => boolean,
  deadline: number
): Promise<{ cols: number; rows: number } | null> {
  let previousDimensions: { cols: number; rows: number } | null = null;
  while (shouldContinue() && performance.now() < deadline) {
    const dimensions = getConversationPaneDimensions(pty, projectId, taskId);
    // A newly mounted destination pane can report an intermediate non-zero
    // height for one layout pass (for example 14 rows) before the task shell
    // and reserved history dock reach their final geometry. Starting the TUI
    // from that first sample makes xterm reflow locally to the later 43-row
    // grid while the backend remains at 14 rows. Require the same measured
    // grid across consecutive browser frames before binding a generation to
    // it; this costs only a frame for an already-stable pane.
    if (
      dimensions &&
      previousDimensions?.cols === dimensions.cols &&
      previousDimensions.rows === dimensions.rows
    ) {
      return dimensions;
    }
    previousDimensions = dimensions;

    const nextLayout = new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => resolve());
      } else {
        // Node-focused store tests do not install a browser frame clock. Keep
        // their fallback asynchronous without coupling it to fake timers.
        void Promise.resolve().then(resolve);
      }
    });
    const advanced = await waitForStagingStep(nextLayout, shouldContinue, deadline);
    if (advanced.status !== 'resolved') return null;
  }
  return null;
}

function shouldPlayNotificationSound(event: AgentEvent): boolean {
  if (!event.source) return true;

  const kind = getAgentNotificationKind(event);
  if (!kind) return true;

  const now = Date.now();
  for (const [key, timestamp] of recentSoundEvents) {
    if (now - timestamp >= SOUND_DEDUPE_WINDOW_MS) recentSoundEvents.delete(key);
  }

  const key = `${event.conversationId}:${kind}`;
  const previous = recentSoundEvents.get(key);
  if (previous !== undefined && now - previous < SOUND_DEDUPE_WINDOW_MS) return false;
  recentSoundEvents.set(key, now);
  return true;
}

export class ConversationManagerStore {
  private _loaded = false;
  private _loadPromise: Promise<void> | null = null;
  /**
   * Whether `conversations` represents a completed backend snapshot. It stays
   * false while an observed, non-preloaded manager is fetching so consumers do
   * not mistake its temporary empty map for a deleted conversation list.
   */
  hasAuthoritativeSnapshot = false;
  /**
   * Terminal outcome for the latest authoritative snapshot request. Consumers
   * must not translate a rejected load into an endless "resolving" state.
   */
  loadError: unknown | null = null;
  private offAgentEvents: (() => void) | null = null;
  private offAuthoritativeStatus: (() => void) | null = null;
  private offSessionExited: (() => void) | null = null;
  private offConversationRenamed: (() => void) | null = null;
  private offConversationArchived: (() => void) | null = null;
  private offConversationMoved: (() => void) | null = null;
  private readonly pendingConversationTitles = new Map<string, string>();
  private readonly pendingContextForks = new Map<string, Promise<Conversation>>();
  private readonly pendingConversationForks = new Map<string, Promise<Conversation>>();
  private readonly resumeLeases = new WeakMap<ConversationStore, object>();
  private readonly openPreparationLeases = new WeakMap<ConversationStore, object>();
  private readonly runtimeStatusRevisions = new Map<string, number>();
  conversations = observable.map<string, ConversationStore>();

  constructor(
    private readonly projectId: string,
    private readonly taskId: string,
    preloaded?: Conversation[],
    private readonly onUserPromptAt?: (lastInteractedAt: string) => void
  ) {
    makeObservable(this, {
      conversations: observable,
      hasAuthoritativeSnapshot: observable,
      loadError: observable.ref,
      taskStatus: computed,
    });
    if (preloaded !== undefined) {
      this._loaded = true;
      this.hasAuthoritativeSnapshot = true;
      const owned = preloaded.filter((conversation) => this._belongsHere(conversation));
      for (const conversation of owned) {
        const store = this.createConversationStore(conversation);
        this.conversations.set(conversation.id, store);
      }
      void this.hydrateRuntimeStatuses(owned.map((conversation) => conversation.id));
    }
    onBecomeObserved(this, 'conversations', () => {
      if (this._loaded) return;
      void this.load().catch((error: unknown) => {
        log.warn('ConversationManagerStore: failed to load conversations', {
          projectId: this.projectId,
          taskId: this.taskId,
          error,
        });
      });
    });
    this.offAuthoritativeStatus = this.listenToAuthoritativeStatus();
    // Install provider truth before the legacy/display event stream. Hook
    // delivery sends status first and AgentEvent second; this ordering avoids
    // a constructor-edge race where only the latter is observed and mistaken
    // for a renderer prediction.
    this.offAgentEvents = this.listenToAgentEvents();
    this.offSessionExited = this.listenToSessionExited();
    this.offConversationRenamed = this.listenToConversationRenamed();
    this.offConversationArchived = this.listenToConversationArchived();
    this.offConversationMoved = this.listenToConversationMoved();
  }

  private listenToAgentEvents(): () => void {
    return events.on(agentEventChannel, ({ event, appFocused }) => {
      if (event.taskId !== this.taskId) return;
      const conversationStore = this.conversations.get(event.conversationId);
      if (!conversationStore) return;
      log.debug('[conversation-status] agent event', {
        projectId: event.projectId,
        taskId: event.taskId,
        conversationId: event.conversationId,
        type: event.type,
        source: event.source ?? null,
        notificationType: event.payload.notificationType ?? null,
      });
      if (event.type === 'awaiting-input') {
        conversationStore.setAwaitingInput('elicitation_dialog', {
          actionDescription: event.payload.message ?? event.payload.title,
        });
        if (shouldPlayNotificationSound(event)) {
          soundPlayer.play('needs_attention', appFocused);
        }
        return;
      }
      if (event.type === 'awaiting-input-resolved') {
        conversationStore.setWorking({
          force: true,
          // The main-process hook reducer publishes the authoritative fence
          // immediately before forwarding this display event. Preserve that
          // result; never promote a renderer-only event into provider truth.
          providerTurnConfirmed: conversationStore.providerTurnConfirmed,
        });
        return;
      }
      if (event.type === 'prompt-submit') {
        // UserPromptSubmit hook — a new turn started, no matter where the
        // prompt was typed (terminal TUI or Yoda input box).
        conversationStore.setWorking({
          force: true,
          providerTurnConfirmed: conversationStore.providerTurnConfirmed,
        });
        return;
      }
      if (event.type === 'notification') {
        const nt = event.payload.notificationType;
        if (!isAttentionNotification(nt)) return;
        conversationStore.setAwaitingInput(nt, {
          actionDescription: event.payload.message ?? event.payload.title,
        });
        if (shouldPlayNotificationSound(event)) {
          soundPlayer.play('needs_attention', appFocused);
        }
        return;
      }
      if (event.type === 'stop') {
        conversationStore.setStatus('completed');
        if (shouldPlayNotificationSound(event)) {
          soundPlayer.play('task_complete', appFocused);
        }
        return;
      }
      if (event.type === 'error') {
        conversationStore.setStatus('error');
        return;
      }
    });
  }

  /**
   * Authoritative run-state pushed from the main process — currently the Codex
   * rollout tailer, which derives turn-started/completed/aborted deterministically
   * from the rollout JSONL. This is the source of truth and overrides the
   * renderer's optimistic predictions. Applied with `emit: false` so it does not
   * bounce back to the main process.
   */
  private listenToAuthoritativeStatus(): () => void {
    return events.on(agentSessionStatusChangedChannel, (event) => {
      if (event.projectId !== this.projectId || event.taskId !== this.taskId) return;
      const conversationStore = this.conversations.get(event.conversationId);
      if (!conversationStore) return;
      log.debug('[conversation-status] authoritative event', {
        projectId: event.projectId,
        taskId: event.taskId,
        conversationId: event.conversationId,
        status: event.status,
        hasPendingAction: Boolean(event.pendingAction),
        providerTurnConfirmed: event.providerTurnConfirmed ?? false,
      });
      conversationStore.applyAuthoritativeStatus(
        event.status,
        event.pendingAction,
        event.providerTurnConfirmed ?? false
      );
    });
  }

  private listenToSessionExited(): () => void {
    return events.on(agentSessionExitedChannel, (event) => {
      if (event.projectId !== this.projectId || event.taskId !== this.taskId) return;
      const conversationStore = this.conversations.get(event.conversationId);
      if (!conversationStore || conversationStore.session.sessionId !== event.sessionId) return;
      // The session id is deliberately stable across resume/restart. Confirm
      // the registry's current owner before changing UI state: a delayed exit
      // from an older PTY otherwise marks its replacement as stopped.
      void this.reconcileExitedSession(conversationStore, event);
    });
  }

  private async reconcileExitedSession(
    conversationStore: ConversationStore,
    event: AgentSessionExited
  ): Promise<void> {
    try {
      const state = await rpc.pty.getSessionState(event.sessionId);
      // The conversation may have moved, been archived, or been replaced
      // while the RPC was in flight. Never apply a stale asynchronous result.
      if (
        this.conversations.get(event.conversationId) !== conversationStore ||
        conversationStore.session.sessionId !== event.sessionId
      ) {
        return;
      }
      if (state.live) {
        conversationStore.markSessionRunning(state.generation);
        return;
      }
      // A replacement is being spawned but has not registered yet. Holding the
      // existing UI state avoids a stopped flash between generations.
      if (state.registering || state.generation > event.generation) return;
      conversationStore.markSessionExited(event.generation);
    } catch (error) {
      // An exit banner is only useful when it reflects current main-process
      // state. Do not promote an unverified broadcast to visible UI state.
      log.debug('ConversationManagerStore: skipped unverified session exit', {
        projectId: this.projectId,
        taskId: this.taskId,
        conversationId: event.conversationId,
        sessionId: event.sessionId,
        error,
      });
    }
  }

  /**
   * Repair an already-visible conversation after it mounts. This covers a
   * renderer that retained an old `sessionExited` flag across an app reload
   * while the main process kept the live PTY running.
   */
  async reconcileSessionLiveness(conversationId: string): Promise<void> {
    const conversationStore = this.conversations.get(conversationId);
    if (!conversationStore) return;
    const sessionId = conversationStore.session.sessionId;
    try {
      const state = await rpc.pty.getSessionState(sessionId);
      if (
        this.conversations.get(conversationId) !== conversationStore ||
        conversationStore.session.sessionId !== sessionId
      ) {
        return;
      }
      if (state.live || state.registering) {
        conversationStore.markSessionRunning(state.generation);
      }
    } catch (error) {
      log.debug('ConversationManagerStore: failed to reconcile session liveness', {
        projectId: this.projectId,
        taskId: this.taskId,
        conversationId,
        sessionId,
        error,
      });
      // During a renderer-only hot update the main process may still expose
      // the previous RPC surface. Its established session-info endpoint has a
      // conservative `running` bit derived from the active provider process;
      // use it only to clear an inherited false stopped state.
      try {
        const sessionInfo = await rpc.conversations.getConversationSessionInfo(
          this.projectId,
          this.taskId,
          conversationId
        );
        if (
          this.conversations.get(conversationId) !== conversationStore ||
          conversationStore.session.sessionId !== sessionId
        ) {
          return;
        }
        if (sessionInfo.running) conversationStore.setSessionExited(false);
      } catch (fallbackError) {
        log.debug('ConversationManagerStore: session liveness fallback failed', {
          projectId: this.projectId,
          taskId: this.taskId,
          conversationId,
          sessionId,
          error: fallbackError,
        });
      }
    }
  }

  private listenToConversationRenamed(): () => void {
    return events.on(conversationRenamedChannel, (event) => {
      if (event.projectId !== this.projectId || event.taskId !== this.taskId) return;
      const conversationStore = this.conversations.get(event.conversationId);
      if (!conversationStore) {
        this.pendingConversationTitles.set(event.conversationId, event.title);
        return;
      }
      runInAction(() => {
        this.pendingConversationTitles.delete(event.conversationId);
        conversationStore.data.title = event.title;
      });
    });
  }

  private listenToConversationArchived(): () => void {
    return events.on(conversationArchivedChannel, (event) => {
      if (event.projectId !== this.projectId || event.taskId !== this.taskId) return;
      const conversationStore = this.conversations.get(event.conversationId);
      if (!conversationStore) return;
      runInAction(() => {
        this.conversations.delete(event.conversationId);
      });
      conversationStore.dispose();
    });
  }

  private listenToConversationMoved(): () => void {
    return events.on(conversationMovedChannel, (event) => {
      if (event.conversation.projectId !== this.projectId) return;

      if (event.sourceTaskId === this.taskId) {
        const moved = this.conversations.get(event.conversation.id);
        if (moved) {
          runInAction(() => this.conversations.delete(event.conversation.id));
          moved.dispose();
        }
        return;
      }

      if (event.targetTaskId !== this.taskId || event.conversation.archivedAt) return;
      runInAction(() => {
        const existing = this.conversations.get(event.conversation.id);
        if (existing) {
          existing.data = event.conversation;
          return;
        }
        const moved = this.createConversationStore(event.conversation);
        this.conversations.set(event.conversation.id, moved);
      });
      void this.hydrateRuntimeStatuses([event.conversation.id]);
    });
  }

  get taskStatus(): AgentStatus | null {
    let hasWorking = false;
    let hasUnseenError = false;
    let hasUnseenCompleted = false;
    let hasInterrupted = false;
    for (const conversation of this.conversations.values()) {
      if (conversation.status === 'awaiting-input') return 'awaiting-input';
      if (conversation.status === 'working') hasWorking = true;
      if (conversation.status === 'interrupted') hasInterrupted = true;
      if (!conversation.seen && conversation.status === 'error') hasUnseenError = true;
      if (!conversation.seen && conversation.status === 'completed') hasUnseenCompleted = true;
    }
    if (hasWorking) return 'working';
    if (hasUnseenError) return 'error';
    if (hasUnseenCompleted) return 'completed';
    // Last: any sibling session with a real outcome describes the task better
    // than "one of its turns was cut short".
    if (hasInterrupted) return 'interrupted';
    return null;
  }

  async load(): Promise<void> {
    if (this._loadPromise) return this._loadPromise;
    if (this._loaded) return;

    this._loaded = true;
    runInAction(() => {
      this.loadError = null;
    });
    this._loadPromise = loadConversationSnapshotWithDeadline(this.projectId, this.taskId)
      .then(async (conversations) => {
        runInAction(() => {
          this.mergeConversations(conversations);
          // Sweep any pre-existing foreign entries (pollution that predates
          // the ownership guards, e.g. surviving a hot reload).
          for (const [id, store] of this.conversations) {
            if (!this._belongsHere(store.data)) this.conversations.delete(id);
          }
          this.hasAuthoritativeSnapshot = true;
          this.loadError = null;
        });
        await this.hydrateRuntimeStatuses(conversations.map((conversation) => conversation.id));
      })
      .catch((error: unknown) => {
        runInAction(() => {
          this._loaded = false;
          this.loadError = error;
        });
        throw error;
      })
      .finally(() => {
        this._loadPromise = null;
      });
    return this._loadPromise;
  }

  /** Retry a failed authoritative snapshot without relying on observation firing again. */
  retryLoad(): Promise<void> {
    const pending = this._loadPromise;
    if (!pending) return this.load();
    // `loadError` is published from the rejection action immediately before
    // the shared promise's finally clears `_loadPromise`. A very fast retry
    // click must wait through that finally instead of receiving the same stale
    // rejection again.
    return pending.catch(() => undefined).then(() => this.load());
  }

  /** Ownership guard: conversations from other tasks must never enter this store. */
  private _belongsHere(conversation: Conversation): boolean {
    const owned = conversation.taskId === this.taskId && conversation.projectId === this.projectId;
    if (!owned) {
      console.warn('[conversations] dropping foreign conversation from store', {
        managerProjectId: this.projectId,
        managerTaskId: this.taskId,
        conversation: {
          id: conversation.id,
          projectId: conversation.projectId,
          taskId: conversation.taskId,
        },
      });
    }
    return owned;
  }

  private createConversationStore(conversation: Conversation): ConversationStore {
    return new ConversationStore(conversation, () =>
      this.markRuntimeStatusChanged(conversation.id)
    );
  }

  private markRuntimeStatusChanged(conversationId: string): void {
    this.runtimeStatusRevisions.set(
      conversationId,
      (this.runtimeStatusRevisions.get(conversationId) ?? 0) + 1
    );
  }

  async ensureConversation(conversationId: string): Promise<boolean> {
    if (!this._loaded || this._loadPromise) {
      await this.load();
    }
    const cached = this.conversations.get(conversationId);
    if (cached) {
      // Self-heal: a polluted entry from another task is evicted instead of
      // being "successfully" opened against the wrong workspace.
      if (this._belongsHere(cached.data)) return true;
      this.conversations.delete(conversationId);
      return false;
    }

    const conversations = await loadConversationSnapshotWithDeadline(this.projectId, this.taskId);
    runInAction(() => {
      this._loaded = true;
      this.mergeConversations(conversations);
      this.hasAuthoritativeSnapshot = true;
      this.loadError = null;
    });
    await this.hydrateRuntimeStatuses(conversations.map((conversation) => conversation.id));
    return this.conversations.has(conversationId);
  }

  private mergeConversations(conversations: Conversation[]): void {
    for (const conversation of conversations) {
      if (!this._belongsHere(conversation)) continue;
      const nextConversation = this.consumePendingConversationTitle(conversation);
      const existing = this.conversations.get(conversation.id);
      if (existing) {
        existing.data = nextConversation;
        continue;
      }
      const store = this.createConversationStore(nextConversation);
      this.conversations.set(conversation.id, store);
      // All conversations stay renderer-lazy until a real terminal surface
      // explicitly requests their session. Status-only panels remain passive.
    }
  }

  private consumePendingConversationTitle(conversation: Conversation): Conversation {
    const pendingTitle = this.pendingConversationTitles.get(conversation.id);
    if (pendingTitle === undefined) return conversation;
    this.pendingConversationTitles.delete(conversation.id);
    if (conversation.title === pendingTitle) return conversation;
    return { ...conversation, title: pendingTitle };
  }

  private async hydrateRuntimeStatuses(conversationIds: string[]): Promise<void> {
    if (conversationIds.length === 0) return;
    const baselineRevisions = new Map(
      conversationIds.map((conversationId) => [
        conversationId,
        this.runtimeStatusRevisions.get(conversationId) ?? 0,
      ])
    );
    try {
      const statuses = await rpc.conversations.getConversationRuntimeStatuses(
        this.projectId,
        this.taskId,
        conversationIds
      );
      runInAction(() => {
        for (const [conversationId, status] of Object.entries(statuses)) {
          // The backend is the stateless authority (derived from the transcript),
          // so apply every verdict including `idle` — that's how a stale `working`
          // from before a restart gets corrected on cold load.
          if (
            (this.runtimeStatusRevisions.get(conversationId) ?? 0) !==
            baselineRevisions.get(conversationId)
          ) {
            continue;
          }
          this.conversations.get(conversationId)?.hydrateStatus(status);
        }
      });
    } catch (error) {
      log.warn('ConversationManagerStore: failed to hydrate runtime statuses', {
        projectId: this.projectId,
        taskId: this.taskId,
        error,
      });
    }
  }

  async createConversation(params: CreateConversationParams): Promise<Conversation> {
    const conversation = this.consumePendingConversationTitle(
      await rpc.conversations.createConversation(params)
    );
    runInAction(() => {
      const store = this.createConversationStore(conversation);
      this.conversations.set(conversation.id, store);
    });
    this.onUserPromptAt?.(conversation.lastInteractedAt ?? new Date().toISOString());
    return conversation;
  }

  forkConversationAtPrompt(params: ForkConversationAtPromptParams): Promise<Conversation> {
    const key = this.contextForkKey(params);
    const existing = this.pendingContextForks.get(key);
    if (existing) return existing;

    const pending = this.createContextFork(params).finally(() => {
      if (this.pendingContextForks.get(key) === pending) {
        this.pendingContextForks.delete(key);
      }
    });
    this.pendingContextForks.set(key, pending);
    return pending;
  }

  forkConversation(params: ForkConversationParams): Promise<Conversation> {
    const existing = this.pendingConversationForks.get(params.conversationId);
    if (existing) return existing;

    const pending = this.createConversationFork(params).finally(() => {
      if (this.pendingConversationForks.get(params.conversationId) === pending) {
        this.pendingConversationForks.delete(params.conversationId);
      }
    });
    this.pendingConversationForks.set(params.conversationId, pending);
    return pending;
  }

  isContextForkPending(
    params: Pick<ForkConversationAtPromptParams, 'conversationId' | 'promptIndex' | 'target'>
  ): boolean {
    return this.pendingContextForks.has(this.contextForkKey(params));
  }

  private contextForkKey(
    params: Pick<ForkConversationAtPromptParams, 'conversationId' | 'promptIndex' | 'target'>
  ): string {
    const targetId =
      params.target.kind === 'claude-message' ? params.target.messageId : params.target.turnId;
    return `${params.conversationId}:${params.promptIndex}:${params.target.kind}:${targetId}`;
  }

  private async createContextFork(params: ForkConversationAtPromptParams): Promise<Conversation> {
    const conversation = this.consumePendingConversationTitle(
      await rpc.conversations.forkConversationAtPrompt(params)
    );
    this.addForkedConversation(conversation);
    return conversation;
  }

  private async createConversationFork(params: ForkConversationParams): Promise<Conversation> {
    const conversation = this.consumePendingConversationTitle(
      await rpc.conversations.forkConversation(params)
    );
    this.addForkedConversation(conversation);
    return conversation;
  }

  private addForkedConversation(conversation: Conversation): void {
    runInAction(() => {
      const store = this.createConversationStore(conversation);
      this.conversations.set(conversation.id, store);
      if (conversation.resume) {
        store.setSessionExited(true);
      }
    });
    this.onUserPromptAt?.(conversation.lastInteractedAt ?? new Date().toISOString());
  }

  async markConversationWorking(conversationId: string): Promise<void> {
    if (!this._loaded || this._loadPromise) {
      await this.load();
    }

    runInAction(() => {
      const store = this.conversations.get(conversationId);
      if (!store) {
        log.warn(`ConversationManagerStore: conversation ${conversationId} not found after load`, {
          projectId: this.projectId,
          taskId: this.taskId,
        });
        return;
      }
      store.setWorking();
    });
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const snapshot = this.conversations.get(conversationId);
    if (!snapshot) return;

    runInAction(() => {
      this.conversations.delete(conversationId);
    });

    try {
      await rpc.conversations.deleteConversation(this.projectId, this.taskId, conversationId);
      snapshot.dispose();
    } catch (err) {
      runInAction(() => {
        this.conversations.set(conversationId, snapshot);
      });
      throw err;
    }
  }

  async archiveConversation(
    conversationId: string,
    options: { runPreArchiveCommand?: boolean } = {}
  ): Promise<void> {
    if (!this.conversations.has(conversationId)) return;

    // No optimistic removal: the archive may run a pre-archive command in the
    // main process first (potentially minutes). The conversationArchivedChannel
    // event removes the store once the archive actually lands.
    await rpc.conversations.archiveConversation(this.projectId, this.taskId, conversationId, {
      runPreArchiveCommand: options.runPreArchiveCommand,
    });
  }

  async renameConversation(conversationId: string, name: string): Promise<void> {
    const store = this.conversations.get(conversationId);
    if (!store) return;

    const previousTitle = store.data.title;

    runInAction(() => {
      store.data.title = name;
    });

    try {
      await rpc.conversations.renameConversation(conversationId, name);
    } catch (err) {
      runInAction(() => {
        store.data.title = previousTitle;
      });
      throw err;
    }
  }

  async touchConversation(conversationId: string): Promise<void> {
    const store = this.conversations.get(conversationId);
    if (!store) return;
    const now = new Date().toISOString();
    runInAction(() => {
      store.data.lastInteractedAt = now;
    });
    this.onUserPromptAt?.(now);
    await rpc.conversations.touchConversation(conversationId, now);
  }

  async resumeConversation(
    conversationId: string,
    initialSize?: { cols: number; rows: number },
    options: {
      skipLiveProbe?: boolean;
      requireGenerationBoundResize?: boolean;
      shouldContinue?: () => boolean;
      performanceContext?: SessionOpenPerformanceContext;
    } = {}
  ): Promise<boolean> {
    const store = this.conversations.get(conversationId);
    if (!store) return false;
    const resumeLease = {};
    const sessionGenerationAtStart = store.getSessionGeneration();
    this.resumeLeases.set(store, resumeLease);
    const ownsResumeLease = () =>
      this.conversations.get(conversationId) === store &&
      this.resumeLeases.get(store) === resumeLease &&
      (options.shouldContinue?.() ?? true);
    const ownsUngeneratedFailureLease = () =>
      ownsResumeLease() && store.getSessionGeneration() === sessionGenerationAtStart;
    if (!options.requireGenerationBoundResize) store.setSessionExited(false);
    try {
      const sessionId = makePtySessionId(this.projectId, this.taskId, conversationId);
      const confirmGenerationBoundResize = async (
        generation: number,
        dimensions: { cols: number; rows: number }
      ): Promise<boolean> => {
        const resized = await rpc.pty.resizeForRenderer(
          sessionId,
          generation,
          dimensions.cols,
          dimensions.rows
        );
        if (!resized.success || resized.data.generation !== generation || !ownsResumeLease()) {
          return false;
        }
        const currentPty = store.session.pty;
        if (currentPty) currentPty.lastSentDims = dimensions;
        return true;
      };
      // The common task-switch path already has a live backend/tmux session.
      // Avoid the heavier resume controller (DB lookup, permission reconcile,
      // operation lock) and simply attach the renderer to the current PTY
      // generation. If this lightweight probe is unavailable during a
      // renderer-only update, fall through to the compatible resume RPC.
      const existingState =
        store.session.pty && !options.skipLiveProbe
          ? await rpc.pty.getSessionState(sessionId).catch(() => null)
          : null;
      if (existingState?.live) {
        if (!ownsResumeLease()) return true;
        const mountedSize = options.requireGenerationBoundResize
          ? (initialSize ?? store.session.pty?.lastSentDims)
          : (store.session.pty?.lastSentDims ?? initialSize);
        if (
          options.requireGenerationBoundResize &&
          mountedSize &&
          !(await confirmGenerationBoundResize(existingState.generation, mountedSize))
        ) {
          return false;
        }
        if (!ownsResumeLease()) return true;
        store.session.pty?.expectCanonicalGeneration(existingState.generation);
        store.markSessionRunning(existingState.generation);
        const needsCodexSurfaceFence =
          store.data.runtimeId === 'codex' &&
          !store.session.pty?.hasCanonicalSurfaceFence(existingState.generation);
        if (mountedSize && !options.requireGenerationBoundResize && !needsCodexSurfaceFence) {
          void rpc.pty.resize(sessionId, mountedSize.cols, mountedSize.rows);
        }
        if (!needsCodexSurfaceFence) return true;
        // A staging timeout can hand a live Codex PTY to the mounted surface
        // before its transcript fence arrives. The active-session resume RPC
        // does not respawn the Agent; it only supplies generation-bound
        // rollout evidence so the visible-frame wait cannot fall back to an
        // impossible quiet window under Codex's continuous idle redraws.
      }

      const result = (await (options.performanceContext
        ? rpc.conversations.resumeConversation(
            this.projectId,
            this.taskId,
            conversationId,
            initialSize,
            options.performanceContext
          )
        : rpc.conversations.resumeConversation(
            this.projectId,
            this.taskId,
            conversationId,
            initialSize
          ))) as Awaited<ReturnType<typeof rpc.conversations.resumeConversation>> | boolean;
      // Renderer-only hot updates can temporarily talk to the previous main
      // process RPC, whose resume result was the running boolean itself.
      const running = typeof result === 'boolean' ? result : result.running;
      const generation = typeof result === 'boolean' ? undefined : result.generation;
      const reason = typeof result === 'boolean' ? undefined : result.reason;
      const surfaceAnchor =
        typeof result !== 'boolean' && result.running ? result.surfaceAnchor : undefined;
      if (!running) {
        if (reason === 'external-writer') {
          if (ownsResumeLease()) {
            store.setSessionResumeBlockReason(reason);
            store.setSessionExited(false);
          }
          return false;
        }
        if (ownsResumeLease()) store.setSessionResumeBlockReason(null);
        if (generation !== undefined) {
          if (ownsResumeLease()) store.markSessionExited(generation);
        } else if (ownsUngeneratedFailureLease()) {
          store.markSessionExited();
        }
        return false;
      }
      if (!ownsResumeLease()) return true;
      const shouldBindSurfaceFence =
        store.data.runtimeId === 'codex' && generation !== undefined && surfaceAnchor !== undefined;
      // Mount-time measurement can finish while the main process is still
      // creating the backend PTY. That early resize sees no registered PTY,
      // while initialSize may still be xterm's 80x24 fallback. Reapply the
      // latest measured grid after spawn so the TUI paints the full pane on
      // first launch instead of waiting for a reload.
      const mountedSize = options.requireGenerationBoundResize
        ? (initialSize ?? store.session.pty?.lastSentDims)
        : (store.session.pty?.lastSentDims ?? initialSize);
      if (options.requireGenerationBoundResize || shouldBindSurfaceFence) {
        if (
          generation === undefined ||
          !mountedSize ||
          !(await confirmGenerationBoundResize(generation, mountedSize))
        ) {
          return false;
        }
      }
      if (!ownsResumeLease()) return true;
      if (generation !== undefined) {
        store.session.pty?.expectCanonicalGeneration(generation);
      }
      if (shouldBindSurfaceFence && generation !== undefined && surfaceAnchor) {
        store.session.pty?.expectCanonicalSurfaceAnchor(generation, surfaceAnchor);
      }
      store.markSessionRunning(generation ?? 0);
      if (mountedSize && !options.requireGenerationBoundResize && !shouldBindSurfaceFence) {
        void rpc.pty.resize(sessionId, mountedSize.cols, mountedSize.rows);
      }
      return true;
    } catch (error) {
      if (!options.requireGenerationBoundResize && ownsUngeneratedFailureLease()) {
        store.markSessionExited();
      }
      log.warn('ConversationManagerStore: failed to resume conversation', {
        projectId: this.projectId,
        taskId: this.taskId,
        conversationId,
        error,
      });
      return false;
    }
  }

  /** Prepare a final live terminal frame while its task route is still hidden. */
  async prepareConversationForOpen(
    conversationId: string,
    shouldContinue: () => boolean,
    timeoutMs = 1_000,
    performanceContext?: SessionOpenPerformanceContext
  ): Promise<boolean | ConversationResumeBlockReason> {
    const store = this.conversations.get(conversationId);
    const deadline = performance.now() + Math.max(0, timeoutMs);
    const canContinue = () => shouldContinue() && performance.now() < deadline;
    if (!store || !canContinue()) return false;

    const preparationLease = {};
    this.openPreparationLeases.set(store, preparationLease);
    const ownsPreparationLease = () =>
      this.conversations.get(conversationId) === store &&
      this.openPreparationLeases.get(store) === preparationLease;
    const rendererBeforePreparation = store.session.pty;
    let connectPromise: Promise<void> | null = null;
    let preparedPty: FrontendPty | null = null;
    let delivered = false;
    let cleanupDeferredUntilConnect = false;
    // A staging deadline is not a navigation cancellation. The caller commits
    // the already-mounted destination and lets ConversationSession continue
    // the generation-aware visible-frame wait. Reclaiming its fresh renderer
    // here can leave that visible surface with no xterm and no observable edge
    // that would start another connection attempt.
    const shouldHandOffRendererToVisibleSurface = () =>
      !delivered && shouldContinue() && ownsPreparationLease();
    const discardCreatedRenderer = () => {
      if (rendererBeforePreparation || !ownsPreparationLease()) return;
      const candidate = preparedPty ?? store.session.pty;
      if (candidate) store.session.discardUnconnectedRenderer(candidate);
    };

    try {
      connectPromise = store.session.connect();
      const connected = await waitForStagingStep(connectPromise, canContinue, deadline);
      if (connected.status !== 'resolved' || !canContinue()) return false;

      const pty = store.session.pty;
      preparedPty = pty;
      if (!pty || !canContinue()) return false;
      const shouldHoldRevealClaim = () =>
        shouldContinue() &&
        this.conversations.get(conversationId) === store &&
        store.session.pty === pty &&
        (delivered || (ownsPreparationLease() && performance.now() < deadline));

      // Wait for the opaque destination layout to register its task-keyed pane,
      // then measure it with this terminal's own cell metrics. A source task,
      // sidebar pin, or stale 80x24 fallback is never a valid canonical grid.
      const initialSize = await waitForConversationPaneDimensions(
        pty,
        this.projectId,
        this.taskId,
        canContinue,
        deadline
      );
      if (!initialSize || !canContinue()) return false;
      const sessionId = makePtySessionId(this.projectId, this.taskId, conversationId);
      const probe = () =>
        waitForStagingStep(
          rpc.pty.getSessionState(sessionId).catch(() => null),
          canContinue,
          deadline
        );
      const probeSettledRegistration = async () => {
        let outcome = await probe();
        while (
          outcome.status === 'resolved' &&
          outcome.value?.registering === true &&
          canContinue()
        ) {
          // The currently live generation is explicitly stale once a newer
          // registration intent exists. Wait within the same absolute task-open
          // budget; never resize or canonicalize that outgoing framebuffer.
          const registrationSettled = await waitForStagingStep(
            new Promise<void>((resolve) => setTimeout(resolve, STAGING_CANCELLATION_POLL_MS)),
            canContinue,
            deadline
          );
          if (registrationSettled.status !== 'resolved') return registrationSettled;
          outcome = await probe();
        }
        return outcome;
      };
      const resizeGeneration = async (
        generation: number
      ): Promise<'ready' | 'retry' | 'stopped'> => {
        const resized = await waitForStagingStep(
          rpc.pty.resizeForRenderer(sessionId, generation, initialSize.cols, initialSize.rows),
          canContinue,
          deadline
        );
        if (resized.status !== 'resolved' || !canContinue()) return 'stopped';
        if (!resized.value.success || resized.value.data.generation !== generation) return 'retry';
        if (store.session.pty !== pty || !ownsPreparationLease()) return 'stopped';
        pty.lastSentDims = initialSize;
        pty.expectCanonicalGeneration(generation);
        store.markSessionRunning(generation);
        return 'ready';
      };
      const resumeAndBindSurfaceFence = async (): Promise<
        { status: 'ready'; generation: number } | { status: 'external-writer' | 'stopped' }
      > => {
        const resumed = await waitForStagingStep(
          this.resumeConversation(conversationId, initialSize, {
            skipLiveProbe: true,
            requireGenerationBoundResize: true,
            shouldContinue: canContinue,
            performanceContext,
          }),
          canContinue,
          deadline
        );
        if (resumed.status !== 'resolved' || !canContinue()) return { status: 'stopped' };
        if (!resumed.value) {
          if (store.sessionResumeBlockReason === 'external-writer') {
            return { status: 'external-writer' };
          }
          return { status: 'stopped' };
        }
        return { status: 'ready', generation: store.getSessionGeneration() };
      };

      // Probe + generation-bound resize is retried at most once. A disappeared
      // generation falls through to the genuine stopped-session resume path.
      let stateOutcome = await probeSettledRegistration();
      if (stateOutcome.status !== 'resolved' || !canContinue()) return false;
      let state = stateOutcome.value;
      let running = false;
      let runningGeneration: number | null = null;
      let surfaceFenceGeneration: number | null = null;
      if (state?.live) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const resized = await resizeGeneration(state.generation);
          if (resized === 'ready') {
            running = true;
            runningGeneration = state.generation;
            break;
          }
          if (resized === 'stopped' || attempt === 1) return false;

          stateOutcome = await probeSettledRegistration();
          if (stateOutcome.status !== 'resolved' || !canContinue()) return false;
          state = stateOutcome.value;
          if (!state?.live) break;
        }
      }

      if (!running) {
        // With transcript fallback removed, the registry ring safely captures
        // startup output. Wait for resume to confirm the new generation before
        // subscribing, so an old final snapshot cannot satisfy first-frame prep.
        const resumed = await resumeAndBindSurfaceFence();
        if (resumed.status === 'external-writer') {
          // The durable transcript renderer is already connected. Preserve it
          // as the read-only destination and let the task route commit normally
          // instead of misreporting a canonical-frame failure.
          delivered = true;
          return 'external-writer';
        }
        if (resumed.status !== 'ready') return false;
        running = true;
        runningGeneration = resumed.generation;
        if (store.data.runtimeId === 'codex') surfaceFenceGeneration = resumed.generation;
      }

      // A live main-process PTY with an evicted renderer bypasses the ordinary
      // provider-resume path above. Cold Codex opens still need bounded rollout
      // evidence, so ask the active-session resume controller for its anchor;
      // that branch returns without spawning another Agent.
      if (
        store.data.runtimeId === 'codex' &&
        runningGeneration !== null &&
        surfaceFenceGeneration !== runningGeneration
      ) {
        const anchored = await resumeAndBindSurfaceFence();
        if (anchored.status !== 'ready') return false;
        runningGeneration = anchored.generation;
        surfaceFenceGeneration = anchored.generation;
      }

      if (
        !running ||
        runningGeneration === null ||
        store.session.pty !== pty ||
        !ownsPreparationLease()
      ) {
        return false;
      }
      let needsFirstFrame = true;
      while (canContinue()) {
        let frameReady = true;
        if (needsFirstFrame) {
          const remainingMs = Math.max(0, deadline - performance.now());
          if (remainingMs <= 0) return false;
          const prepared = await waitForStagingStep(
            store.session.prepareFirstFrame(initialSize, canContinue, {
              waitForCanonicalOutput: true,
              timeoutMs: remainingMs,
            }),
            canContinue,
            deadline
          );
          if (prepared.status !== 'resolved' || !canContinue()) return false;
          frameReady = prepared.value;
        }

        if (frameReady && pty.canonicalGeneration === runningGeneration) {
          const preparedGeneration = runningGeneration;
          const claimReady = await waitForStagingStep(
            pty.acquireCanonicalRevealClaim(
              shouldHoldRevealClaim,
              Math.min(STAGING_REVEAL_CLAIM_TIMEOUT_MS, Math.max(0, deadline - performance.now())),
              { requireMountedFramePaint: true }
            ),
            canContinue,
            deadline
          );
          if (claimReady.status !== 'resolved' || !canContinue()) return false;
          if (claimReady.value && pty.canonicalGeneration === preparedGeneration) {
            delivered = true;
            return true;
          }
          // The claim can legitimately succeed for G+1 if its sentinel arrives
          // after G was prepared but before claimGenerationReveal samples the
          // renderer. Never carry that newer claim across a G-sized staging
          // transaction; release it and rebuild G+1 below.
          if (claimReady.value) pty.releaseCanonicalRevealClaim();
        }

        // `prepareFirstFrame(G)` and the exact-generation painted reveal claim
        // are one staging transaction. A G+1 registration can begin between
        // preparation and claim, so re-probe once and rebuild only for a
        // genuinely newer generation.
        stateOutcome = await probeSettledRegistration();
        if (stateOutcome.status !== 'resolved' || !canContinue()) return false;
        state = stateOutcome.value;
        if (!state?.live) return false;

        if (runningGeneration !== state.generation) {
          while (canContinue()) {
            const resized = await resizeGeneration(state.generation);
            if (resized === 'stopped') return false;
            if (resized === 'ready') {
              runningGeneration = state.generation;
              if (store.data.runtimeId === 'codex') {
                const anchored = await resumeAndBindSurfaceFence();
                if (anchored.status !== 'ready') return false;
                runningGeneration = anchored.generation;
                surfaceFenceGeneration = anchored.generation;
              }
              needsFirstFrame = true;
              break;
            }

            const retryDelay = await waitForStagingStep(
              new Promise<void>((resolve) => setTimeout(resolve, STAGING_CANCELLATION_POLL_MS)),
              canContinue,
              deadline
            );
            if (retryDelay.status !== 'resolved') return false;

            stateOutcome = await probeSettledRegistration();
            if (stateOutcome.status !== 'resolved' || !canContinue()) return false;
            state = stateOutcome.value;
            if (!state?.live) return false;
          }
          continue;
        }

        // A busy same-generation TUI or a transient claim/paint miss must not
        // keep the route transition alive. The real destination is already
        // mounted; hand readiness to its generation-aware visible-frame retry
        // loop, which preserves the Logo until a browser-painted frame exists.
        return false;
      }
      return false;
    } catch (error) {
      log.warn('ConversationManagerStore: failed to stage conversation for open', {
        projectId: this.projectId,
        taskId: this.taskId,
        conversationId,
        error,
      });
      return false;
    } finally {
      if (!delivered && !shouldHandOffRendererToVisibleSurface()) {
        discardCreatedRenderer();
      }
      if (
        !delivered &&
        !rendererBeforePreparation &&
        !preparedPty &&
        connectPromise &&
        ownsPreparationLease()
      ) {
        // connect() can itself be waiting on an eviction/settings barrier when
        // the absolute task-open deadline expires. Reclaim only if this request
        // still owns the preparation lease after that shared promise settles,
        // and only when its navigation was actually cancelled. A deadline with
        // a current destination is the visible surface's connection handoff.
        cleanupDeferredUntilConnect = true;
        void connectPromise.then(
          () => {
            if (!shouldHandOffRendererToVisibleSurface()) discardCreatedRenderer();
            if (ownsPreparationLease()) this.openPreparationLeases.delete(store);
          },
          () => {
            if (ownsPreparationLease()) this.openPreparationLeases.delete(store);
          }
        );
      }
      // Once delivered, the claim predicate no longer depends on this internal
      // preparation lease; it remains fenced by the caller's navigation lease
      // and exact PTY/store identity until React's visible paint ACK.
      if (!cleanupDeferredUntilConnect && ownsPreparationLease()) {
        this.openPreparationLeases.delete(store);
      }
    }
  }

  async restartConversation(
    conversationId: string,
    initialSize?: { cols: number; rows: number },
    tmuxOverride?: boolean,
    enableSkillKey?: string,
    runtimeOverrides?: SessionRuntimeOverrides
  ): Promise<void> {
    const store = this.conversations.get(conversationId);
    if (!store) return;
    store.setSessionExited(false);
    // Default to the live terminal's current size so the restarted session
    // (and, under tmux, the freshly created tmux window) is born at the real
    // pane width instead of the 80x24 main-process fallback — otherwise tmux
    // draws at the wrong width until the first resize and corrupts wrapping.
    const effectiveSize = initialSize ?? store.session.pty?.lastSentDims ?? undefined;
    try {
      const result = (await rpc.conversations.restartConversation(
        this.projectId,
        this.taskId,
        conversationId,
        effectiveSize,
        tmuxOverride,
        enableSkillKey,
        runtimeOverrides
      )) as Awaited<ReturnType<typeof rpc.conversations.restartConversation>> | undefined;
      // Renderer-only hot updates can briefly keep the previous main-process
      // controller alive. That controller completed the restart successfully
      // but returned void, before restart responses carried PTY generations.
      const generation = result?.generation;
      store.markSessionRunning(generation ?? 0);
      await store.session.reconnect();
      if (generation !== undefined) {
        store.session.pty?.expectCanonicalGeneration(generation);
      }
      if (effectiveSize) {
        const sessionId = makePtySessionId(this.projectId, this.taskId, conversationId);
        void rpc.pty.resize(sessionId, effectiveSize.cols, effectiveSize.rows);
      }
    } catch (error) {
      store.markSessionExited();
      log.warn('ConversationManagerStore: failed to restart conversation', {
        projectId: this.projectId,
        taskId: this.taskId,
        conversationId,
        error,
      });
    }
  }

  /**
   * Rebuild the renderer-owned terminal for a conversation without restarting
   * its Agent process or backend PTY. This is the user-facing "reload" path:
   * the fresh frontend reattaches to the canonical main-process snapshot while
   * the running session continues uninterrupted.
   */
  async reloadConversationView(conversationId: string): Promise<void> {
    const store = this.conversations.get(conversationId);
    if (!store) return;
    try {
      await store.session.reconnect();
    } catch (error) {
      log.warn('ConversationManagerStore: failed to reload conversation view', {
        projectId: this.projectId,
        taskId: this.taskId,
        conversationId,
        error,
      });
    }
  }

  dispose(): void {
    this.offAgentEvents?.();
    this.offAgentEvents = null;
    this.offAuthoritativeStatus?.();
    this.offAuthoritativeStatus = null;
    this.offSessionExited?.();
    this.offSessionExited = null;
    this.offConversationRenamed?.();
    this.offConversationRenamed = null;
    this.offConversationArchived?.();
    this.offConversationArchived = null;
    this.offConversationMoved?.();
    this.offConversationMoved = null;
    this.pendingConversationTitles.clear();
    this.pendingContextForks.clear();
    this.pendingConversationForks.clear();
    this.runtimeStatusRevisions.clear();
    for (const conversation of this.conversations.values()) {
      conversation.dispose();
    }
  }
}

/**
 * Suppress classifier-derived awaiting-input notifications that fire within
 * this window after a user-confirmed working transition. Classifiers scan the
 * tail of PTY output for permission/approve/confirm keywords and easily
 * re-trigger on the echoed prompt right after the user answers, which would
 * otherwise immediately flip the sidebar back to awaiting-input.
 */
const POST_SUBMIT_NOTIFICATION_GRACE_MS = 3000;

export class ConversationStore {
  data: Conversation;
  session: PtySession;
  status: AgentStatus = 'idle';
  /** Provider-owned evidence exists for the currently running turn. */
  providerTurnConfirmed = false;
  seen = true;
  /** True while the archive flow (pre-archive command + archive) is in flight. */
  isArchiving = false;
  /**
   * True after the agent process died on its own (CLI exited — e.g. a Codex
   * self-update quits the binary). Cleared when a resume/restart respawns it.
   * Drives the "session exited → reload" affordance in the conversations panel.
   */
  sessionExited = false;
  /** A provider-level ownership conflict that leaves durable history readable. */
  sessionResumeBlockReason: ConversationResumeBlockReason | null = null;
  /** View-only dismissal; a new exit always makes the notice visible again. */
  sessionExitNoticeDismissed = false;
  lastNotificationType: NotificationType | null = null;
  /** Human-readable "what is it waiting on" context for `awaiting-input`. */
  pendingActionDescription: string | null = null;
  private lastForceWorkingAt = 0;
  /** Latest backend instance known to be running for this stable session id. */
  private sessionGeneration = 0;

  constructor(
    conversation: Conversation,
    private readonly onStatusChanged?: () => void
  ) {
    this.data = conversation;
    this.session = new PtySession(
      makePtySessionId(conversation.projectId, conversation.taskId, conversation.id)
    );
    makeObservable(this, {
      data: observable,
      session: observable,
      status: observable,
      providerTurnConfirmed: observable,
      seen: observable,
      isArchiving: observable,
      sessionExited: observable,
      sessionResumeBlockReason: observable,
      sessionExitNoticeDismissed: observable,
      setSessionExited: action,
      setSessionResumeBlockReason: action,
      markSessionRunning: action,
      markSessionExited: action,
      dismissSessionExitNotice: action,
      lastNotificationType: observable,
      pendingActionDescription: observable,
      setStatus: action,
      setArchiving: action,
      hydrateStatus: action,
      applyAuthoritativeStatus: action,
      setAwaitingInput: action,
      setWorking: action,
      clearWorking: action,
      markSeen: action,
      isInitialConversation: computed,
      indicatorStatus: computed,
    });
  }

  get isInitialConversation(): boolean {
    return this.data.isInitialConversation === true;
  }

  get indicatorStatus(): AgentStatus | null {
    if (this.status === 'working') return 'working';
    if (this.status === 'awaiting-input') return 'awaiting-input';
    // A cut-short turn is a standing fact about the session, not a notification,
    // so it survives being seen — unlike error/completed below.
    if (this.status === 'interrupted') return 'interrupted';
    if (this.seen) return null;
    if (this.status === 'error') return 'error';
    if (this.status === 'completed') return 'completed';
    return null;
  }

  setStatus(
    status: AgentStatus,
    options: {
      emit?: boolean;
      providerTurnConfirmed?: boolean;
      preserveProviderTurnConfirmed?: boolean;
    } = {}
  ) {
    const previousStatus = this.status;
    const previousProviderTurnConfirmed = this.providerTurnConfirmed;
    const providerTurnConfirmed = !isAgentSessionRunningStatus(status)
      ? false
      : options.providerTurnConfirmed !== undefined
        ? options.providerTurnConfirmed
        : options.preserveProviderTurnConfirmed || status === 'awaiting-input'
          ? previousProviderTurnConfirmed
          : false;
    const statusChanged = previousStatus !== status;
    const providerTurnConfirmedChanged = previousProviderTurnConfirmed !== providerTurnConfirmed;
    const changed = statusChanged || providerTurnConfirmedChanged;
    this.status = status;
    this.providerTurnConfirmed = providerTurnConfirmed;
    this.seen = status === 'idle' || status === 'working';
    if (status !== 'awaiting-input') {
      this.lastNotificationType = null;
      this.pendingActionDescription = null;
    }
    if (changed) {
      this.onStatusChanged?.();
      if (statusChanged) {
        publishAgentRuntimeStatusPreview({
          projectId: this.data.projectId,
          taskId: this.data.taskId,
          conversationId: this.data.id,
          status,
        });
      }
      log.debug('[conversation-status] transition', {
        projectId: this.data.projectId,
        taskId: this.data.taskId,
        conversationId: this.data.id,
        from: previousStatus,
        to: status,
        providerTurnConfirmedFrom: previousProviderTurnConfirmed,
        providerTurnConfirmedTo: providerTurnConfirmed,
        emitsStatusEvent: options.emit !== false,
      });
    }
    if (changed && options.emit !== false) {
      events.emit(agentSessionStatusChangedChannel, {
        projectId: this.data.projectId,
        taskId: this.data.taskId,
        conversationId: this.data.id,
        status,
        providerTurnConfirmed,
        ...(status === 'awaiting-input' && this.lastNotificationType
          ? {
              pendingAction: {
                notificationType: this.lastNotificationType,
                actionDescription: this.pendingActionDescription ?? undefined,
              },
            }
          : {}),
      });
    }
  }

  hydrateStatus(status: AgentStatus) {
    // The main process publishes the provider fence immediately before this
    // status-only RPC resolves. Preserve that richer event snapshot here.
    this.setStatus(status, { emit: false, preserveProviderTurnConfirmed: true });
  }

  /**
   * Apply a deterministic status pushed from the main-process authority (the
   * Codex rollout tailer). Overrides optimistic local predictions. Does not
   * re-emit, since the main process is already the source.
   */
  applyAuthoritativeStatus(
    status: AgentStatus,
    pendingAction?: PendingAction | null,
    providerTurnConfirmed = false
  ) {
    if (status === 'awaiting-input') {
      this.lastNotificationType = pendingAction?.notificationType ?? 'elicitation_dialog';
      this.pendingActionDescription = pendingAction?.actionDescription?.trim() || null;
      this.setStatus(status, { emit: false, providerTurnConfirmed });
      return;
    }
    if (status === 'working') {
      // Refresh the post-submit grace anchor so a classifier echo right after a
      // real turn-start doesn't immediately flip back to awaiting-input.
      this.lastForceWorkingAt = Date.now();
    }
    this.setStatus(status, { emit: false, providerTurnConfirmed });
  }

  setAwaitingInput(notificationType: NotificationType, context?: { actionDescription?: string }) {
    // Ignore classifier-driven awaiting-input echoes that fire right after the
    // user submitted a reply — the agent is still working, not waiting again.
    if (
      this.status === 'working' &&
      Date.now() - this.lastForceWorkingAt < POST_SUBMIT_NOTIFICATION_GRACE_MS
    ) {
      return;
    }
    this.lastNotificationType = notificationType;
    this.pendingActionDescription = context?.actionDescription?.trim() || null;
    this.setStatus('awaiting-input');
  }

  setWorking(options: { force?: boolean; providerTurnConfirmed?: boolean } = {}) {
    if (
      !options.force &&
      this.status === 'awaiting-input' &&
      this.lastNotificationType === 'permission_prompt'
    ) {
      return;
    }
    if (options.force) {
      this.lastForceWorkingAt = Date.now();
    }
    this.lastNotificationType = null;
    this.setStatus('working', {
      providerTurnConfirmed: options.providerTurnConfirmed ?? false,
    });
  }

  clearWorking() {
    if (this.status === 'working') {
      this.setStatus('idle');
    }
  }

  markSeen() {
    this.seen = true;
  }

  setArchiving(value: boolean) {
    this.isArchiving = value;
  }

  setSessionExited(value: boolean) {
    this.sessionExited = value;
    if (value) this.sessionResumeBlockReason = null;
    this.sessionExitNoticeDismissed = false;
  }

  setSessionResumeBlockReason(reason: ConversationResumeBlockReason | null) {
    this.sessionResumeBlockReason = reason;
  }

  getSessionGeneration(): number {
    return this.sessionGeneration;
  }

  markSessionRunning(generation: number) {
    if (Number.isSafeInteger(generation) && generation > this.sessionGeneration) {
      this.sessionGeneration = generation;
    }
    this.sessionResumeBlockReason = null;
    this.setSessionExited(false);
  }

  markSessionExited(generation?: number) {
    if (generation !== undefined) {
      if (!Number.isSafeInteger(generation) || generation < this.sessionGeneration) return;
      this.sessionGeneration = generation;
    }
    this.clearWorking();
    this.sessionResumeBlockReason = null;
    this.sessionExited = true;
    this.sessionExitNoticeDismissed = false;
  }

  dismissSessionExitNotice() {
    this.sessionExitNoticeDismissed = true;
  }

  dispose() {
    this.session.dispose();
  }
}
