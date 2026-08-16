import { describe, expect, it, vi } from 'vitest';
import { WORKSPACE_NOTIFICATION_LIMIT, WorkspaceNotificationStore } from './notification-store';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
}

function requireId(id: string | null): string {
  if (id === null) throw new Error('notification was filtered out of the center');
  return id;
}

describe('WorkspaceNotificationStore', () => {
  it('keeps newest notifications first and caps persisted history', () => {
    const storage = createStorage();
    const store = new WorkspaceNotificationStore('notifications', () => storage);

    for (let index = 0; index < WORKSPACE_NOTIFICATION_LIMIT + 4; index += 1) {
      store.enqueue({
        title: `Notification ${index}`,
        kind: 'info',
        source: 'toast',
        reason: 'action-required',
      });
    }

    expect(store.getSnapshot()).toHaveLength(WORKSPACE_NOTIFICATION_LIMIT);
    expect(store.getSnapshot()[0].title).toBe(`Notification ${WORKSPACE_NOTIFICATION_LIMIT + 3}`);
    expect(storage.setItem).toHaveBeenCalled();
  });

  it('updates an existing notification in place without duplicating it', () => {
    const store = new WorkspaceNotificationStore('notifications', () => null);
    const id = requireId(
      store.enqueue({
        title: 'Working…',
        kind: 'loading',
        source: 'toast',
        reason: 'subscribed-result',
      })
    );

    store.enqueue(
      { title: 'Finished', kind: 'success', source: 'toast', reason: 'subscribed-result' },
      id
    );

    expect(store.getSnapshot()).toMatchObject([
      { id, title: 'Finished', kind: 'success', source: 'toast' },
    ]);
  });

  it('supports deleting one notification and clearing the queue', () => {
    const storage = createStorage();
    const store = new WorkspaceNotificationStore('notifications', () => storage);
    const first = requireId(
      store.enqueue({
        title: 'First',
        kind: 'info',
        source: 'system',
        reason: 'action-required',
      })
    );
    store.enqueue({ title: 'Second', kind: 'error', source: 'toast', reason: 'error' });

    store.remove(first);
    expect(store.getSnapshot().map((entry) => entry.title)).toEqual(['Second']);

    store.clear();
    expect(store.getSnapshot()).toEqual([]);
    expect(storage.removeItem).toHaveBeenCalledWith('notifications');
  });

  it('tracks unread state per notification and supports marking the queue read', () => {
    const storage = createStorage();
    const store = new WorkspaceNotificationStore('notifications', () => storage);
    const first = requireId(
      store.enqueue({
        title: 'First',
        kind: 'info',
        source: 'system',
        reason: 'action-required',
      })
    );
    const second = requireId(
      store.enqueue({
        title: 'Second',
        kind: 'success',
        source: 'toast',
        reason: 'subscribed-result',
      })
    );

    expect(store.getSnapshot().map((entry) => entry.readAt)).toEqual([null, null]);

    store.markRead(first);
    expect(store.getSnapshot().find((entry) => entry.id === first)?.readAt).not.toBeNull();
    expect(store.getSnapshot().find((entry) => entry.id === second)?.readAt).toBeNull();

    store.markUnread(first);
    expect(store.getSnapshot().find((entry) => entry.id === first)?.readAt).toBeNull();

    store.markAllRead();
    expect(store.getSnapshot().every((entry) => entry.readAt !== null)).toBe(true);
    expect(storage.setItem).toHaveBeenCalled();
  });

  it('migrates retained notifications from before read tracking as read', () => {
    const storage = createStorage();
    storage.setItem(
      'notifications',
      JSON.stringify([
        {
          id: 'legacy',
          title: 'Earlier notification',
          kind: 'info',
          source: 'system',
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      ])
    );
    const store = new WorkspaceNotificationStore('notifications', () => storage);

    expect(store.getSnapshot()[0].readAt).toBe('2026-08-01T00:00:00.000Z');
  });

  it('keeps live actions executable without persisting callbacks', () => {
    const storage = createStorage();
    const store = new WorkspaceNotificationStore('notifications', () => storage);
    const onClick = vi.fn();
    const id = requireId(
      store.enqueue(
        {
          title: 'Reusable operation',
          kind: 'info',
          source: 'toast',
          reason: 'action-required',
        },
        undefined,
        { label: 'Save operation', onClick }
      )
    );

    expect(store.getAction(id)?.label).toBe('Save operation');
    expect(storage.setItem.mock.calls.at(-1)?.[1]).not.toContain('Save operation');

    store.invokeAction(id, 'event');

    expect(onClick).toHaveBeenCalledWith('event');
    expect(store.getAction(id)).toBeUndefined();
    expect(store.getSnapshot()).toEqual([]);
  });

  it('coalesces repeated events and resolves the original notification', () => {
    const store = new WorkspaceNotificationStore('notifications', () => null);
    const firstId = requireId(
      store.enqueue({
        title: 'Connection unavailable',
        kind: 'info',
        source: 'system',
        reason: 'blocking-warning',
        dedupeKey: 'gateway:offline',
      })
    );
    const secondId = store.enqueue({
      title: 'Connection still unavailable',
      kind: 'info',
      source: 'system',
      reason: 'blocking-warning',
      dedupeKey: 'gateway:offline',
    });

    expect(secondId).toBe(firstId);
    expect(store.getSnapshot()).toMatchObject([
      { id: firstId, occurrenceCount: 2, status: 'active', readAt: null },
    ]);

    store.resolve(firstId, {
      title: 'Connection restored',
      description: 'The gateway is reachable again.',
    });

    expect(store.getSnapshot()).toMatchObject([
      {
        id: firstId,
        title: 'Connection restored',
        kind: 'success',
        status: 'resolved',
        occurrenceCount: 2,
      },
    ]);
    expect(store.getSnapshot()[0].readAt).not.toBeNull();
    expect(store.getSnapshot()[0].resolvedAt).not.toBeNull();
  });

  it('drops sources the user excluded from the center', () => {
    const storage = createStorage();
    const store = new WorkspaceNotificationStore('notifications', () => storage);
    store.setRetainedSources({ toast: true, agent: false, automation: true, system: true });

    const filtered = store.enqueue({
      title: 'Agent is waiting for input',
      kind: 'info',
      source: 'agent',
      reason: 'action-required',
    });
    store.enqueue({ title: 'Build failed', kind: 'error', source: 'toast', reason: 'error' });

    expect(filtered).toBeNull();
    expect(store.getSnapshot().map((entry) => entry.title)).toEqual(['Build failed']);

    store.setRetainedSources({ toast: true, agent: true, automation: true, system: true });
    store.enqueue({
      title: 'Agent is waiting for input',
      kind: 'info',
      source: 'agent',
      reason: 'action-required',
    });

    expect(store.getSnapshot().map((entry) => entry.title)).toEqual([
      'Agent is waiting for input',
      'Build failed',
    ]);
  });
});
