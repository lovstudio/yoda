/**
 * The entries this plugin ships. They go through the same registry a third-party
 * DSH plugin would use — no privileged built-in path — so if the registration
 * contract is broken for others, it is broken for these four too.
 */
import type { RuntimeBarRegistry } from '@yoda/runtime-bar/registry';
import { BarCwdItem } from './items/cwd-item.tsx';
import { BarJobsItem } from './items/jobs-item.tsx';
import { BarSessionsItem } from './items/sessions-item.tsx';
import { BarStateItem } from './items/state-item.tsx';

/**
 * Register the built-in entries.
 * @param registry - the bar registry provided by this plugin's activation.
 * @returns a disposer that removes all of them again.
 */
export function registerBuiltinItems(registry: RuntimeBarRegistry): () => void {
  const disposers = [
    registry.register({ id: 'cwd', slot: 'lead', order: 0, Component: BarCwdItem }),
    registry.register({ id: 'state', slot: 'session', order: 0, Component: BarStateItem }),
    registry.register({ id: 'jobs', slot: 'session', order: 10, Component: BarJobsItem }),
    registry.register({ id: 'sessions', slot: 'tray', order: 0, Component: BarSessionsItem }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
