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

describe('WorkspaceNotificationStore', () => {
  it('keeps newest notifications first and caps persisted history', () => {
    const storage = createStorage();
    const store = new WorkspaceNotificationStore('notifications', () => storage);

    for (let index = 0; index < WORKSPACE_NOTIFICATION_LIMIT + 4; index += 1) {
      store.enqueue({ title: `Notification ${index}`, kind: 'info', source: 'toast' });
    }

    expect(store.getSnapshot()).toHaveLength(WORKSPACE_NOTIFICATION_LIMIT);
    expect(store.getSnapshot()[0].title).toBe(`Notification ${WORKSPACE_NOTIFICATION_LIMIT + 3}`);
    expect(storage.setItem).toHaveBeenCalled();
  });

  it('updates an existing notification in place without duplicating it', () => {
    const store = new WorkspaceNotificationStore('notifications', () => null);
    const id = store.enqueue({ title: 'Working…', kind: 'loading', source: 'toast' });

    store.enqueue({ title: 'Finished', kind: 'success', source: 'toast' }, id);

    expect(store.getSnapshot()).toMatchObject([
      { id, title: 'Finished', kind: 'success', source: 'toast' },
    ]);
  });

  it('supports deleting one notification and clearing the queue', () => {
    const storage = createStorage();
    const store = new WorkspaceNotificationStore('notifications', () => storage);
    const first = store.enqueue({ title: 'First', kind: 'info', source: 'system' });
    store.enqueue({ title: 'Second', kind: 'error', source: 'toast' });

    store.remove(first);
    expect(store.getSnapshot().map((entry) => entry.title)).toEqual(['Second']);

    store.clear();
    expect(store.getSnapshot()).toEqual([]);
    expect(storage.removeItem).toHaveBeenCalledWith('notifications');
  });
});
