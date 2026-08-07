export const WORKSPACE_NOTIFICATION_STORAGE_KEY = 'yoda:workspace-notifications:v1';
export const WORKSPACE_NOTIFICATION_LIMIT = 200;

export type WorkspaceNotificationKind = 'info' | 'success' | 'error' | 'loading';
export type WorkspaceNotificationSource = 'toast' | 'agent' | 'automation' | 'system';

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
  source: WorkspaceNotificationSource;
  createdAt: string;
  target?: WorkspaceNotificationTarget;
};

export type WorkspaceNotificationInput = Omit<WorkspaceNotification, 'id' | 'createdAt'>;

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

function isNotification(value: unknown): value is WorkspaceNotification {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<WorkspaceNotification>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.title === 'string' &&
    typeof entry.createdAt === 'string' &&
    (entry.kind === 'info' ||
      entry.kind === 'success' ||
      entry.kind === 'error' ||
      entry.kind === 'loading') &&
    (entry.source === 'toast' ||
      entry.source === 'agent' ||
      entry.source === 'automation' ||
      entry.source === 'system')
  );
}

export class WorkspaceNotificationStore {
  private entries: WorkspaceNotification[] = [];
  private loaded = false;
  private storageListenerAttached = false;
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

  enqueue(
    input: WorkspaceNotificationInput,
    existingId?: string,
    action?: WorkspaceNotificationAction
  ): string {
    this.ensureLoaded();
    this.refreshFromStorage();

    const id = existingId ?? createNotificationId();
    const next: WorkspaceNotification = {
      ...input,
      id,
      title: input.title.trim(),
      description: input.description?.trim() || undefined,
      details: input.details?.trim() || undefined,
      createdAt: new Date().toISOString(),
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

  invokeAction(id: string, event: unknown): void {
    const action = this.actions.get(id);
    if (!action) return;
    action.onClick(event);
    this.actions.delete(id);
    this.entries = [...this.entries];
    this.emit();
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
      this.entries = parsed.filter(isNotification).slice(0, WORKSPACE_NOTIFICATION_LIMIT);
    } catch {}
  }

  private persistAndEmit(): void {
    const storage = this.getStorage();
    try {
      storage?.setItem(this.storageKey, JSON.stringify(this.entries));
    } catch {}
    this.emit();
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
        ? parsed.filter(isNotification).slice(0, WORKSPACE_NOTIFICATION_LIMIT)
        : [];
    } catch {
      return [];
    }
  }
}

export const workspaceNotificationStore = new WorkspaceNotificationStore();
