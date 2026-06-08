import { action, computed, makeObservable, observable, onBecomeObserved, runInAction } from 'mobx';
import { type Conversation, type CreateConversationParams } from '@shared/conversations';
import {
  agentEventChannel,
  agentSessionExitedChannel,
  agentSessionStatusChangedChannel,
  isAttentionNotification,
  type AgentSessionRuntimeStatus,
  type NotificationType,
} from '@shared/events/agentEvents';
import {
  conversationArchivedChannel,
  conversationRenamedChannel,
} from '@shared/events/conversationEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { events, rpc } from '@renderer/lib/ipc';
import { PtySession } from '@renderer/lib/pty/pty-session';
import { log } from '@renderer/utils/logger';
import { soundPlayer } from '@renderer/utils/soundPlayer';

export type AgentStatus = AgentSessionRuntimeStatus;

export class ConversationManagerStore {
  private _loaded = false;
  private _loadPromise: Promise<void> | null = null;
  private offAgentEvents: (() => void) | null = null;
  private offAuthoritativeStatus: (() => void) | null = null;
  private offSessionExited: (() => void) | null = null;
  private offConversationRenamed: (() => void) | null = null;
  private offConversationArchived: (() => void) | null = null;
  conversations = observable.map<string, ConversationStore>();

  constructor(
    private readonly projectId: string,
    private readonly taskId: string,
    preloaded?: Conversation[],
    private readonly onUserPromptAt?: (lastInteractedAt: string) => void
  ) {
    makeObservable(this, {
      conversations: observable,
      taskStatus: computed,
    });
    if (preloaded && preloaded.length > 0) {
      this._loaded = true;
      for (const conversation of preloaded) {
        const store = new ConversationStore(conversation);
        this.conversations.set(conversation.id, store);
        void store.session.connect();
      }
      void this.hydrateRuntimeStatuses(preloaded.map((conversation) => conversation.id));
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
  }

  private listenToAgentEvents(): () => void {
    return events.on(agentEventChannel, ({ event, appFocused }) => {
      if (event.taskId !== this.taskId) return;
      const conversationStore = this.conversations.get(event.conversationId);
      if (!conversationStore) return;
      if (event.type === 'awaiting-input') {
        conversationStore.setAwaitingInput('elicitation_dialog', {
          actionDescription: event.payload.message ?? event.payload.title,
        });
        soundPlayer.play('needs_attention', appFocused);
        return;
      }
      if (event.type === 'awaiting-input-resolved') {
        conversationStore.setWorking({ force: true });
        return;
      }
      if (event.type === 'notification') {
        const nt = event.payload.notificationType;
        if (!isAttentionNotification(nt)) return;
        conversationStore.setAwaitingInput(nt, {
          actionDescription: event.payload.message ?? event.payload.title,
        });
        soundPlayer.play('needs_attention', appFocused);
        return;
      }
      if (event.type === 'stop') {
        conversationStore.setStatus('completed');
        soundPlayer.play('task_complete', appFocused);
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
      conversationStore.applyAuthoritativeStatus(event.status);
    });
  }

  private listenToSessionExited(): () => void {
    return events.on(agentSessionExitedChannel, (event) => {
      if (event.taskId !== this.taskId) return;
      const conversationStore = this.conversations.get(event.conversationId);
      if (!conversationStore) return;
      conversationStore.clearWorking();
    });
  }

  private listenToConversationRenamed(): () => void {
    return events.on(conversationRenamedChannel, (event) => {
      if (event.projectId !== this.projectId || event.taskId !== this.taskId) return;
      const conversationStore = this.conversations.get(event.conversationId);
      if (!conversationStore) return;
      runInAction(() => {
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

  get taskStatus(): AgentStatus | null {
    let hasWorking = false;
    let hasUnseenError = false;
    let hasUnseenCompleted = false;
    for (const conversation of this.conversations.values()) {
      if (!conversation.seen && conversation.status === 'awaiting-input') return 'awaiting-input';
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

  async ensureConversation(conversationId: string): Promise<boolean> {
    if (!this._loaded || this._loadPromise) {
      await this.load();
    }
    if (this.conversations.has(conversationId)) return true;

    const conversations = await rpc.conversations.getConversationsForTask(
      this.projectId,
      this.taskId
    );
    runInAction(() => {
      this._loaded = true;
      this.mergeConversations(conversations);
    });
    await this.hydrateRuntimeStatuses(conversations.map((conversation) => conversation.id));
    return this.conversations.has(conversationId);
  }

  private mergeConversations(conversations: Conversation[]): void {
    for (const conversation of conversations) {
      const existing = this.conversations.get(conversation.id);
      if (existing) {
        existing.data = conversation;
        continue;
      }
      const store = new ConversationStore(conversation);
      this.conversations.set(conversation.id, store);
      void store.session.connect();
    }
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
          if (status === 'idle') continue;
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
    const conversation = await rpc.conversations.createConversation(params);
    runInAction(() => {
      const store = new ConversationStore(conversation);
      this.conversations.set(conversation.id, store);
      void store.session.connect();
    });
    this.onUserPromptAt?.(conversation.lastInteractedAt ?? new Date().toISOString());
    return conversation;
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

  async archiveConversation(conversationId: string): Promise<void> {
    const snapshot = this.conversations.get(conversationId);
    if (!snapshot) return;

    runInAction(() => {
      this.conversations.delete(conversationId);
    });

    try {
      await rpc.conversations.archiveConversation(this.projectId, this.taskId, conversationId);
      snapshot.dispose();
    } catch (err) {
      runInAction(() => {
        this.conversations.set(conversationId, snapshot);
      });
      throw err;
    }
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
  ): Promise<void> {
    if (!this.conversations.has(conversationId)) return;
    try {
      await rpc.conversations.resumeConversation(
        this.projectId,
        this.taskId,
        conversationId,
        initialSize
      );
      if (initialSize) {
        const sessionId = makePtySessionId(this.projectId, this.taskId, conversationId);
        void rpc.pty.resize(sessionId, initialSize.cols, initialSize.rows);
      }
    } catch (error) {
      log.warn('ConversationManagerStore: failed to resume conversation', {
        projectId: this.projectId,
        taskId: this.taskId,
        conversationId,
        error,
      });
    }
  }

  async restartConversation(
    conversationId: string,
    initialSize?: { cols: number; rows: number },
    tmuxOverride?: boolean
  ): Promise<void> {
    const store = this.conversations.get(conversationId);
    if (!store) return;
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
        tmuxOverride
      );
      await store.session.reconnect();
      if (effectiveSize) {
        const sessionId = makePtySessionId(this.projectId, this.taskId, conversationId);
        void rpc.pty.resize(sessionId, effectiveSize.cols, effectiveSize.rows);
      }
    } catch (error) {
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
      lastNotificationType: observable,
      pendingActionDescription: observable,
      setStatus: action,
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
    if (this.seen) return null;
    if (this.status === 'awaiting-input') return 'awaiting-input';
    if (this.status === 'error') return 'error';
    if (this.status === 'completed') return 'completed';
    return null;
  }

  setStatus(status: AgentStatus, options: { emit?: boolean } = {}) {
    const changed = this.status !== status;
    this.status = status;
    this.seen = status === 'idle' || status === 'working';
    if (status !== 'awaiting-input') {
      this.lastNotificationType = null;
      this.pendingActionDescription = null;
    }
    if (changed && options.emit !== false) {
      events.emit(agentSessionStatusChangedChannel, {
        projectId: this.data.projectId,
        taskId: this.data.taskId,
        conversationId: this.data.id,
        status,
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
  applyAuthoritativeStatus(status: AgentStatus) {
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

  dispose() {
    this.session.dispose();
  }
}
