import {
  DEFAULT_NOTIFICATION_CENTER_SOURCES,
  type NotificationCenterSources,
  type NotificationReason,
  type NotificationSource,
  type NotificationStatus,
} from '@shared/notifications';

export const WORKSPACE_NOTIFICATION_STORAGE_KEY = 'yoda:workspace-notifications:v2';
export const WORKSPACE_NOTIFICATION_LIMIT = 200;

export type WorkspaceNotificationKind = 'info' | 'success' | 'error' | 'loading';

export type WorkspaceNotificationTarget = {
  projectId: string;
  taskId: string;
  conversationId?: string;
};

export type WorkspaceNotification = {
  id: string;
  title: string;
  description?: string;
  details?: string;
  kind: WorkspaceNotificationKind;
  source: NotificationSource;
  reason: NotificationReason;
  status: NotificationStatus;
  createdAt: string;
  updatedAt: string;
  readAt: string | null;
  resolvedAt?: string;
  occurrenceCount: number;
  dedupeKey?: string;
  target?: WorkspaceNotificationTarget;
};

export type WorkspaceNotificationInput = Omit<
  WorkspaceNotification,
  'id' | 'createdAt' | 'updatedAt' | 'readAt' | 'resolvedAt' | 'occurrenceCount' | 'status'
> & {
  status?: NotificationStatus;
};

export type WorkspaceNotificationResolution = Partial<
  Pick<WorkspaceNotification, 'title' | 'description' | 'details' | 'kind'>
>;

export type WorkspaceNotificationAction = {
  label: string;
  onClick: (event: unknown) => void;
};

type NotificationStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

let notificationSequence = 0;

function browserStorage(): NotificationStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function createNotificationId(): string {
  notificationSequence += 1;
  return `${Date.now().toString(36)}-${notificationSequence.toString(36)}`;
}

function parseNotification(value: unknown): WorkspaceNotification | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Partial<WorkspaceNotification>;
  if (
    typeof entry.id !== 'string' ||
    typeof entry.title !== 'string' ||
    typeof entry.createdAt !== 'string' ||
    (entry.kind !== 'info' &&
      entry.kind !== 'success' &&
      entry.kind !== 'error' &&
      entry.kind !== 'loading') ||
    (entry.source !== 'toast' &&
      entry.source !== 'agent' &&
      entry.source !== 'automation' &&
      entry.source !== 'system')
  ) {
    return null;
  }

  return {
    ...entry,
    id: entry.id,
    title: entry.title,
    kind: entry.kind,
    source: entry.source,
    createdAt: entry.createdAt,
    updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : entry.createdAt,
    reason:
      entry.reason === 'action-required' ||
      entry.reason === 'error' ||
      entry.reason === 'blocking-warning' ||
      entry.reason === 'subscribed-result'
        ? entry.reason
        : entry.kind === 'error'
          ? 'error'
          : 'action-required',
    status: entry.status === 'resolved' ? 'resolved' : 'active',
    occurrenceCount:
      typeof entry.occurrenceCount === 'number' && entry.occurrenceCount > 0
        ? entry.occurrenceCount
        : 1,
    // Entries created before read tracking existed are historical, so migrate
    // them as read instead of turning the entire retained queue into unread.
    readAt:
      entry.readAt === null || typeof entry.readAt === 'string' ? entry.readAt : entry.createdAt,
  };
}

export class WorkspaceNotificationStore {
  private entries: WorkspaceNotification[] = [];
  private loaded = false;
  private storageListenerAttached = false;
  private retainedSources: NotificationCenterSources = { ...DEFAULT_NOTIFICATION_CENTER_SOURCES };
  private readonly listeners = new Set<() => void>();
  private readonly actions = new Map<string, WorkspaceNotificationAction>();

  constructor(
    private readonly storageKey = WORKSPACE_NOTIFICATION_STORAGE_KEY,
    private readonly getStorage: () => NotificationStorage | null = browserStorage
  ) {}

  getSnapshot = (): WorkspaceNotification[] => {
    this.ensureLoaded();
    return this.entries;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.ensureLoaded();
    this.attachStorageListener();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * The intake filter the user configures. Producers keep emitting whatever they
   * emit; this decides what is worth keeping a record of.
   */
  setRetainedSources(next: NotificationCenterSources): void {
    this.retainedSources = { ...next };
  }

  retainsSource(source: NotificationSource): boolean {
    return this.retainedSources[source];
  }

  /** Returns the entry id, or null when the source is filtered out. */
  enqueue(
    input: WorkspaceNotificationInput,
    existingId?: string,
    action?: WorkspaceNotificationAction
  ): string | null {
    if (!this.retainsSource(input.source)) return null;
    this.ensureLoaded();
    this.refreshFromStorage();

    const matchedId =
      existingId ??
      (input.dedupeKey
        ? this.entries.find((entry) => entry.dedupeKey === input.dedupeKey)?.id
        : undefined);
    const previous = matchedId ? this.entries.find((entry) => entry.id === matchedId) : undefined;
    const id = matchedId ?? createNotificationId();
    const now = new Date().toISOString();
    const status = input.status ?? 'active';
    const next: WorkspaceNotification = {
      ...input,
      id,
      title: input.title.trim(),
      description: input.description?.trim() || undefined,
      details: input.details?.trim() || undefined,
      status,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      readAt: status === 'resolved' ? now : null,
      resolvedAt: status === 'resolved' ? now : undefined,
      occurrenceCount: previous ? previous.occurrenceCount + 1 : 1,
      dedupeKey: input.dedupeKey ?? previous?.dedupeKey,
    };
    this.entries = [next, ...this.entries.filter((entry) => entry.id !== id)].slice(
      0,
      WORKSPACE_NOTIFICATION_LIMIT
    );
    if (action) {
      this.actions.set(id, action);
    } else {
      this.actions.delete(id);
    }
    this.persistAndEmit();
    return id;
  }

  getAction(id: string): WorkspaceNotificationAction | undefined {
    return this.actions.get(id);
  }

  get(id: string): WorkspaceNotification | undefined {
    this.ensureLoaded();
    return this.entries.find((entry) => entry.id === id);
  }

  getByDedupeKey(dedupeKey: string): WorkspaceNotification | undefined {
    this.ensureLoaded();
    return this.entries.find((entry) => entry.dedupeKey === dedupeKey);
  }

  invokeAction(id: string, event: unknown): void {
    const action = this.actions.get(id);
    if (!action) return;
    action.onClick(event);
    this.remove(id);
  }

  resolve(id: string, resolution: WorkspaceNotificationResolution = {}): void {
    this.ensureLoaded();
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index === -1) return;
    const now = new Date().toISOString();
    const current = this.entries[index];
    const next = [...this.entries];
    next[index] = {
      ...current,
      ...resolution,
      title: resolution.title?.trim() || current.title,
      description:
        resolution.description === undefined
          ? current.description
          : resolution.description.trim() || undefined,
      details:
        resolution.details === undefined ? current.details : resolution.details.trim() || undefined,
      kind: resolution.kind ?? 'success',
      status: 'resolved',
      updatedAt: now,
      resolvedAt: now,
      readAt: now,
    };
    this.entries = next;
    this.actions.delete(id);
    this.persistAndEmit();
  }

  markRead(id: string): void {
    this.setReadState(id, true);
  }

  markUnread(id: string): void {
    this.setReadState(id, false);
  }

  markAllRead(): void {
    this.ensureLoaded();
    if (this.entries.every((entry) => entry.readAt !== null)) return;
    const readAt = new Date().toISOString();
    this.entries = this.entries.map((entry) =>
      entry.readAt === null ? { ...entry, readAt } : entry
    );
    this.persistAndEmit();
  }

  remove(id: string): void {
    this.ensureLoaded();
    const next = this.entries.filter((entry) => entry.id !== id);
    const removedAction = this.actions.delete(id);
    if (next.length === this.entries.length && !removedAction) return;
    this.entries = next;
    this.persistAndEmit();
  }

  clear(): void {
    this.ensureLoaded();
    if (this.entries.length === 0 && this.actions.size === 0) return;
    this.entries = [];
    this.actions.clear();
    const storage = this.getStorage();
    try {
      storage?.removeItem(this.storageKey);
    } catch {}
    this.emit();
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.refreshFromStorage();
  }

  private refreshFromStorage(): void {
    const storage = this.getStorage();
    if (!storage) return;
    try {
      const raw = storage.getItem(this.storageKey);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      this.entries = parsed
        .map(parseNotification)
        .filter((entry): entry is WorkspaceNotification => entry !== null)
        .slice(0, WORKSPACE_NOTIFICATION_LIMIT);
    } catch {}
  }

  private persistAndEmit(): void {
    const storage = this.getStorage();
    try {
      storage?.setItem(this.storageKey, JSON.stringify(this.entries));
    } catch {}
    this.emit();
  }

  private setReadState(id: string, read: boolean): void {
    this.ensureLoaded();
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index === -1) return;
    const current = this.entries[index];
    if ((current.readAt !== null) === read) return;
    const next = [...this.entries];
    next[index] = { ...current, readAt: read ? new Date().toISOString() : null };
    this.entries = next;
    this.persistAndEmit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private attachStorageListener(): void {
    if (this.storageListenerAttached || typeof window === 'undefined') return;
    this.storageListenerAttached = true;
    window.addEventListener('storage', (event) => {
      if (event.key !== this.storageKey) return;
      this.entries = event.newValue ? this.parseEntries(event.newValue) : [];
      const availableIds = new Set(this.entries.map((entry) => entry.id));
      for (const id of this.actions.keys()) {
        if (!availableIds.has(id)) this.actions.delete(id);
      }
      this.emit();
    });
  }

  private parseEntries(raw: string): WorkspaceNotification[] {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed
            .map(parseNotification)
            .filter((entry): entry is WorkspaceNotification => entry !== null)
            .slice(0, WORKSPACE_NOTIFICATION_LIMIT)
        : [];
    } catch {
      return [];
    }
  }
}

export const workspaceNotificationStore = new WorkspaceNotificationStore();
