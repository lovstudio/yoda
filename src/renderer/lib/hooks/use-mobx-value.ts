import { useObserver } from 'mobx-react-lite';

/**
 * Reads a MobX selector through React's observer subscription.
 *
 * This must remain a render-time subscription rather than a useEffect-based
 * one: workspace navigation and task provisioning can change in the same
 * render pass, and an effect subscription may commit a route shell from the
 * previous snapshot around a task panel from the next one.
 */
export function useMobxValue<T>(selector: () => T): T {
  return useObserver(selector);
}
