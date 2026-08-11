import type { Conversation } from '@shared/conversations';
import { makePtySessionId, parsePtySessionId } from '@shared/ptySessionId';

type HydrationBarrier = {
  promise: Promise<void>;
  cancelled: boolean;
};

const hydrationBarriers = new Map<string, HydrationBarrier>();
const hydrationStates = new WeakMap<Promise<void>, HydrationBarrier>();

function hydrationKey(conversation: Pick<Conversation, 'projectId' | 'taskId' | 'id'>): string {
  return makePtySessionId(conversation.projectId, conversation.taskId, conversation.id);
}

/**
 * Keep renderer-driven resume behind the startup hydration decision for a
 * previously attempted first prompt. Otherwise resume can win the provider's
 * single-flight while the tmux marker lookup is still pending and turn an
 * intended reattach into a second delivery attempt.
 */
export function registerConversationHydrationBarrier(
  conversation: Pick<Conversation, 'projectId' | 'taskId' | 'id'>,
  hydration: Promise<void>
): Promise<void> {
  const key = hydrationKey(conversation);
  const barrier: HydrationBarrier = { promise: Promise.resolve(), cancelled: false };
  const tracked = hydration.finally(() => {
    if (hydrationBarriers.get(key) === barrier) hydrationBarriers.delete(key);
  });
  barrier.promise = tracked;
  hydrationStates.set(tracked, barrier);
  hydrationBarriers.set(key, barrier);
  void tracked.catch(() => {});
  return tracked;
}

export function getConversationHydrationBarrier(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<void> | undefined {
  return hydrationBarriers.get(makePtySessionId(projectId, taskId, conversationId))?.promise;
}

export function cancelConversationHydrationBarrier(
  projectId: string,
  taskId: string,
  conversationId: string
): void {
  const barrier = hydrationBarriers.get(makePtySessionId(projectId, taskId, conversationId));
  if (barrier) barrier.cancelled = true;
}

export function cancelConversationHydrationBarriersForTask(
  projectId: string,
  taskId: string
): void {
  for (const [sessionId, barrier] of hydrationBarriers) {
    const parsed = parsePtySessionId(sessionId);
    if (parsed?.projectId === projectId && parsed.scopeId === taskId) barrier.cancelled = true;
  }
}

export function isConversationHydrationCancelled(
  conversation: Pick<Conversation, 'projectId' | 'taskId' | 'id'>
): boolean {
  return hydrationBarriers.get(hydrationKey(conversation))?.cancelled === true;
}

export function wasConversationHydrationCancelled(hydration: Promise<void>): boolean {
  return hydrationStates.get(hydration)?.cancelled === true;
}
