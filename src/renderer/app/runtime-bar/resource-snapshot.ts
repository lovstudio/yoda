import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { rpc } from '@renderer/lib/ipc';
import {
  getWorkspaceResourceQueryTiming,
  WORKSPACE_RESOURCE_QUERY_KEY,
} from '../workspace-resource-monitoring';

/**
 * The bar polls the resource snapshot exactly once, no matter how many entries
 * read it — one query key with one set of options and one request shape.
 *
 * The snapshot's cost is not fixed: sampling live agent processes is only worth
 * paying for while something is showing them. That used to be a single entry's
 * local popover flag, but the agent list and the resource meters are separate
 * entries now, and two `useQuery` calls that disagree about `freshAgentProcesses`
 * (or about the poll interval) race each other on the same key. So the demand
 * lives here as a module-level counter: entries declare that they want fresh
 * process data, and every reader observes the same resolved answer.
 */
const freshAgentProcessDemands = new Set<symbol>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function wantsFreshAgentProcesses(): boolean {
  return freshAgentProcessDemands.size > 0;
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Declares, while `wanted`, that this entry needs live per-process sampling. */
export function useFreshAgentProcesses(wanted: boolean): void {
  const demand = useMemo(() => Symbol('runtimeBarFreshAgentProcesses'), []);
  useEffect(() => {
    if (!wanted) return;
    freshAgentProcessDemands.add(demand);
    notify();
    return () => {
      freshAgentProcessDemands.delete(demand);
      notify();
    };
  }, [demand, wanted]);
}

/** The one resource-snapshot observer. Safe to call from every entry. */
export function useWorkspaceResourceSnapshot() {
  const fresh = useSyncExternalStore(subscribe, wantsFreshAgentProcesses, wantsFreshAgentProcesses);
  return useQuery({
    queryKey: WORKSPACE_RESOURCE_QUERY_KEY,
    queryFn: () => rpc.app.getResourceSnapshot({ freshAgentProcesses: fresh }),
    ...getWorkspaceResourceQueryTiming(fresh),
  });
}
