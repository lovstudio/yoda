import { useDefaultLayout, type Layout, type LayoutStorage } from 'react-resizable-panels';
import { rpc } from '@renderer/lib/ipc';
import { viewStateCache } from '@renderer/lib/stores/view-state-cache';

/**
 * Persists a ResizablePanelGroup's layout (panel sizes) across app restarts.
 *
 * Wraps the library's `useDefaultLayout` with a storage adapter backed by the
 * app's `viewState` store (DB-backed, write-through cached) instead of
 * `localStorage`. Reads resolve synchronously from the bootstrap-populated
 * cache; writes update the cache and fire-and-forget the IPC save.
 *
 * Returns props to spread onto the `<ResizablePanelGroup>`. `groupId` doubles
 * as the storage key, so it must be stable and unique.
 */
export function usePersistentPanelLayout(groupId: string): {
  id: string;
  defaultLayout: Layout | undefined;
  onLayoutChanged: (layout: Layout) => void | undefined;
} {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: groupId,
    storage: viewStateLayoutStorage,
  });
  return { id: groupId, defaultLayout, onLayoutChanged };
}

const viewStateLayoutStorage: LayoutStorage = {
  getItem(key) {
    const value = viewStateCache.peek(key);
    return typeof value === 'string' ? value : null;
  },
  setItem(key, value) {
    viewStateCache.set(key, value);
    void rpc.viewState.save(key, value);
  },
};
