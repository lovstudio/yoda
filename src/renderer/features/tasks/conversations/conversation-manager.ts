import { action, computed, makeObservable, observable, onBecomeObserved, runInAction } from 'mobx';
import {
  type Conversation,
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
  isAttentionNotification,
  type AgentEvent,
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
import { events, rpc } from '@renderer/lib/ipc';
import { PtySession } from '@renderer/lib/pty/pty-session';
import { log } from '@renderer/utils/logger';
import { soundPlayer } from '@renderer/utils/soundPlayer';

export type AgentStatus = AgentSessionRuntimeStatus;

const SOUND_DEDUPE_WINDOW_MS = 3_000;
const recentSoundEvents = new Map<string, number>();

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
  private offAgentEvents: (() => void) | null = null;
  private offAuthoritativeStatus: (() => void) | null = null;
  private offSessionExited: (() => void) | null = null;
  private offConversationRenamed: (() => void) | null = null;
  private offConversationArchived: (() => void) | null = null;
  private offConversationMoved: (() => void) | null = null;
  private readonly pendingConversationTitles = new Map<string, string>();
  private readonly pendingContextForks = new Map<string, Promise<Conversation>>();
  private readonly pendingConversationForks = new Map<string, Promise<Conversation>>();
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
      taskStatus: computed,
    });
    if (preloaded !== undefined) {
      this._loaded = true;
      this.hasAuthoritativeSnapshot = true;
      const owned = preloaded.filter((conversation) => this._belongsHere(conversation));
      for (const conversation of owned) {
        const store = new ConversationStore(conversation);
        this.conversations.set(conversation.id, store);
      }
      void this.hydrateRuntimeStatuses(owned.map((conversation) => conversation.id));
    }
    onBecomeObserved(this, 'conversations', () => {
      if (this._loaded) return;
      void this.load();
    });
    this.offAgentEvents = this.listenToAgentEvents();
    this.offAuthoritativeStatus = this.listenToAuthoritativeStatus();
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
        conversationStore.setWorking({ force: true });
        return;
      }
      if (event.type === 'prompt-submit') {
        // UserPromptSubmit hook — a new turn started, no matter where the
        // prompt was typed (terminal TUI or Yoda input box).
        conversationStore.setWorking({ force: true });
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
      });
      conversationStore.applyAuthoritativeStatus(event.status, event.pendingAction);
    });
  }

  private listenToSessionExited(): () => void {
    return events.on(agentSessionExitedChannel, (event) => {
      if (event.taskId !== this.taskId) return;
      const conversationStore = this.conversations.get(event.conversationId);
      if (!conversationStore) return;
      conversationStore.markSessionExited();
    });
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
        const moved = new ConversationStore(event.conversation);
        this.conversations.set(event.conversation.id, moved);
      });
      void this.hydrateRuntimeStatuses([event.conversation.id]);
    });
  }

  get taskStatus(): AgentStatus | null {
    let hasWorking = false;
    let hasUnseenError = false;
    let hasUnseenCompleted = false;
    for (const conversation of this.conversations.values()) {
      if (conversation.status === 'awaiting-input') return 'awaiting-input';
      if (conversation.status === 'working') hasWorking = true;
      if (!conversation.seen && conversation.status === 'error') hasUnseenError = true;
      if (!conversation.seen && conversation.status === 'completed') hasUnseenCompleted = true;
    }
    if (hasWorking) return 'working';
    if (hasUnseenError) return 'error';
    if (hasUnseenCompleted) return 'completed';
    return null;
  }

  async load(): Promise<void> {
    if (this._loadPromise) return this._loadPromise;
    if (this._loaded) return;

    this._loaded = true;
    this._loadPromise = rpc.conversations
      .getConversationsForTask(this.projectId, this.taskId)
      .then(async (conversations) => {
        runInAction(() => {
          this.mergeConversations(conversations);
          // Sweep any pre-existing foreign entries (pollution that predates
          // the ownership guards, e.g. surviving a hot reload).
          for (const [id, store] of this.conversations) {
            if (!this._belongsHere(store.data)) this.conversations.delete(id);
          }
          this.hasAuthoritativeSnapshot = true;
        });
        await this.hydrateRuntimeStatuses(conversations.map((conversation) => conversation.id));
      })
      .catch((error: unknown) => {
        this._loaded = false;
        throw error;
      })
      .finally(() => {
        this._loadPromise = null;
      });
    return this._loadPromise;
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

    const conversations = await rpc.conversations.getConversationsForTask(
      this.projectId,
      this.taskId
    );
    runInAction(() => {
      this._loaded = true;
      this.mergeConversations(conversations);
      this.hasAuthoritativeSnapshot = true;
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
      const store = new ConversationStore(nextConversation);
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
      const store = new ConversationStore(conversation);
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
      const store = new ConversationStore(conversation);
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
    initialSize?: { cols: number; rows: number }
  ): Promise<boolean> {
    const store = this.conversations.get(conversationId);
    if (!store) return false;
    store.setSessionExited(false);
    try {
      const running = await rpc.conversations.resumeConversation(
        this.projectId,
        this.taskId,
        conversationId,
        initialSize
      );
      if (!running) {
        store.markSessionExited();
        return false;
      }
      store.setSessionExited(false);
      // Mount-time measurement can finish while the main process is still
      // creating the backend PTY. That early resize sees no registered PTY,
      // while initialSize may still be xterm's 80x24 fallback. Reapply the
      // latest measured grid after spawn so the TUI paints the full pane on
      // first launch instead of waiting for a reload.
      const mountedSize = store.session.pty?.lastSentDims ?? initialSize;
      if (mountedSize) {
        const sessionId = makePtySessionId(this.projectId, this.taskId, conversationId);
        void rpc.pty.resize(sessionId, mountedSize.cols, mountedSize.rows);
      }
      return true;
    } catch (error) {
      store.markSessionExited();
      log.warn('ConversationManagerStore: failed to resume conversation', {
        projectId: this.projectId,
        taskId: this.taskId,
        conversationId,
        error,
      });
      return false;
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
      await rpc.conversations.restartConversation(
        this.projectId,
        this.taskId,
        conversationId,
        effectiveSize,
        tmuxOverride,
        enableSkillKey,
        runtimeOverrides
      );
      await store.session.reconnect();
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
  seen = true;
  /** True while the archive flow (pre-archive command + archive) is in flight. */
  isArchiving = false;
  /**
   * True after the agent process died on its own (CLI exited — e.g. a Codex
   * self-update quits the binary). Cleared when a resume/restart respawns it.
   * Drives the "session exited → reload" affordance in the conversations panel.
   */
  sessionExited = false;
  /** View-only dismissal; a new exit always makes the notice visible again. */
  sessionExitNoticeDismissed = false;
  lastNotificationType: NotificationType | null = null;
  /** Human-readable "what is it waiting on" context for `awaiting-input`. */
  pendingActionDescription: string | null = null;
  private lastForceWorkingAt = 0;

  constructor(conversation: Conversation) {
    this.data = conversation;
    this.session = new PtySession(
      makePtySessionId(conversation.projectId, conversation.taskId, conversation.id)
    );
    makeObservable(this, {
      data: observable,
      session: observable,
      status: observable,
      seen: observable,
      isArchiving: observable,
      sessionExited: observable,
      sessionExitNoticeDismissed: observable,
      setSessionExited: action,
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
    if (this.seen) return null;
    if (this.status === 'error') return 'error';
    if (this.status === 'completed') return 'completed';
    return null;
  }

  setStatus(status: AgentStatus, options: { emit?: boolean } = {}) {
    const previousStatus = this.status;
    const changed = previousStatus !== status;
    this.status = status;
    this.seen = status === 'idle' || status === 'working';
    if (status !== 'awaiting-input') {
      this.lastNotificationType = null;
      this.pendingActionDescription = null;
    }
    if (changed) {
      log.debug('[conversation-status] transition', {
        projectId: this.data.projectId,
        taskId: this.data.taskId,
        conversationId: this.data.id,
        from: previousStatus,
        to: status,
        emitsStatusEvent: options.emit !== false,
      });
    }
    if (changed && options.emit !== false) {
      events.emit(agentSessionStatusChangedChannel, {
        projectId: this.data.projectId,
        taskId: this.data.taskId,
        conversationId: this.data.id,
        status,
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
    this.setStatus(status, { emit: false });
  }

  /**
   * Apply a deterministic status pushed from the main-process authority (the
   * Codex rollout tailer). Overrides optimistic local predictions. Does not
   * re-emit, since the main process is already the source.
   */
  applyAuthoritativeStatus(status: AgentStatus, pendingAction?: PendingAction | null) {
    if (status === 'awaiting-input') {
      this.lastNotificationType = pendingAction?.notificationType ?? 'elicitation_dialog';
      this.pendingActionDescription = pendingAction?.actionDescription?.trim() || null;
      this.setStatus(status, { emit: false });
      return;
    }
    if (status === 'working') {
      // Refresh the post-submit grace anchor so a classifier echo right after a
      // real turn-start doesn't immediately flip back to awaiting-input.
      this.lastForceWorkingAt = Date.now();
    }
    this.setStatus(status, { emit: false });
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

  setWorking(options: { force?: boolean } = {}) {
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
    this.setStatus('working');
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
    this.sessionExitNoticeDismissed = false;
  }

  markSessionExited() {
    this.clearWorking();
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
