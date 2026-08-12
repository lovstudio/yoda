import type { AgentSessionStatusChanged } from '@shared/events/agentEvents';

type AgentRuntimeStatusPreviewListener = (event: AgentSessionStatusChanged) => void;

/**
 * Renderer-local hand-off for an optimistic runtime command.
 *
 * `events.emit()` crosses the Electron boundary and is asynchronous from the
 * renderer's point of view. The runtime read model still needs the command
 * immediately, before the main process confirms it. The main-process event
 * remains the authoritative confirmation path.
 */
const listeners = new Set<AgentRuntimeStatusPreviewListener>();

export function publishAgentRuntimeStatusPreview(event: AgentSessionStatusChanged): void {
  for (const listener of listeners) listener(event);
}

export function subscribeAgentRuntimeStatusPreview(
  listener: AgentRuntimeStatusPreviewListener
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
