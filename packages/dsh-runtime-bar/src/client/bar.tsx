/**
 * The mounted bar: the one component the composer-dock slot renders.
 *
 * It resolves the session facts from the framework's selector hooks, publishes
 * them once through context, and hands the entry list to the shared strip. It
 * knows nothing about any individual entry — adding one is a registry call, not
 * an edit here.
 */
import { useRuntimeBarItems, type RuntimeBarRegistry } from '@yoda/runtime-bar/registry';
import { RuntimeBarStrip } from '@yoda/runtime-bar/strip';
import { useMemo, useSyncExternalStore, type ReactElement } from 'react';
import type {
  BarJobView,
  BarLocaleService,
  BarSelectorHook,
  BarSessionList,
  BarWorkspacesService,
} from '../context-types.ts';
import { BarViewProvider, type BarView } from './bar-context.ts';
import { createTranslate } from './locales.ts';
import { DSH_RUNTIME_BAR_THEME } from './theme.ts';

/**
 * Shared empty set, so a runtime without the jobs mirror hands the same array
 * identity on every render instead of a fresh one that re-renders the entries.
 */
const NO_JOBS: readonly BarJobView[] = Object.freeze([]);

type RuntimeBarProps = {
  /** Session-scope standard prop: the session this dock belongs to. */
  sessionId: string;
  /** Global standard prop: the workspace's session list. */
  useSessions: BarSelectorHook<BarSessionList>;
  /** From the registration's `inject` factory. */
  registry: RuntimeBarRegistry;
  locale: BarLocaleService;
  workspaces: BarWorkspacesService;
};

export function RuntimeBar({
  sessionId,
  useSessions,
  registry,
  locale,
  workspaces,
}: RuntimeBarProps): ReactElement {
  const items = useRuntimeBarItems(registry);
  const active = useSyncExternalStore(
    locale.subscribe,
    () => locale.getSnapshot().active,
    () => locale.getSnapshot().active
  );

  // One selector per value, all primitives or snapshot-stable references: a
  // selector returning a fresh object would re-render the bar on every list
  // event, and this bar sits under a streaming conversation.
  const session = useSessions((state) => state.byId[sessionId]);
  const jobs = useSessions((state) => state.jobsBySession?.[sessionId]) ?? NO_JOBS;
  const sessionCount = useSessions((state) => state.ids.length);
  const runningSessionCount = useSessions(
    (state) => state.ids.filter((id) => state.byId[id]?.running === true).length
  );

  const view = useMemo<BarView>(
    () => ({
      sessionId,
      session,
      jobs,
      sessionCount,
      runningSessionCount,
      t: createTranslate(active),
      openPath: (path) => {
        // Fire-and-forget by design: the Host owns the outcome (it surfaces its
        // own failure), and a status bar has nowhere to report one.
        void workspaces.openPath(path);
      },
    }),
    [sessionId, session, jobs, sessionCount, runningSessionCount, active, workspaces]
  );

  return (
    <BarViewProvider value={view}>
      <RuntimeBarStrip
        data-plugin-surface="runtime-bar"
        items={items}
        theme={DSH_RUNTIME_BAR_THEME}
        sessionActive={session !== undefined}
      />
    </BarViewProvider>
  );
}
