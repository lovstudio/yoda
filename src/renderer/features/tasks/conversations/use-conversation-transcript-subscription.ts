import { useEffect, useRef } from 'react';
import { conversationTranscriptChangedChannel } from '@shared/events/conversationEvents';
import { events, rpc } from '@renderer/lib/ipc';

/**
 * Keeps one conversation's on-disk transcript (Claude session JSONL / Codex
 * rollout) subscribed while `active`, and calls `onChange` on every append the
 * main process observes — plus once after the watcher is attached.
 *
 * Every surface that derives from the transcript shares this: the ordering is
 * the delicate part, not the fetch. The listener attaches *before* the watcher
 * so an append landing between the initial read and watch setup is not lost,
 * and cleanup awaits the deferred subscribe before releasing it so rapid
 * open/close cannot leak a ref-count.
 *
 * `onChange` is read through a ref, so a caller may pass an inline closure
 * without resubscribing on every render.
 */
export function useConversationTranscriptSubscription({
  active,
  projectId,
  taskId,
  conversationId,
  onChange,
}: {
  active: boolean;
  projectId: string | undefined;
  taskId: string | undefined;
  conversationId: string | undefined;
  onChange: () => void;
}): void {
  const onChangeRef = useRef(onChange);
  // Declared before the subscription effect so a re-render's callback is in
  // place before any event it should handle. The initial value comes from
  // useRef itself, so the first mount is already covered.
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!active || !projectId || !taskId || !conversationId) return;
    let cancelled = false;
    const notify = () => {
      if (!cancelled) onChangeRef.current();
    };

    const off = events.on(conversationTranscriptChangedChannel, notify, conversationId);
    const subscribed = rpc.conversations.subscribeConversationTranscript(
      projectId,
      taskId,
      conversationId
    );
    // A failed watch must not stop the caller from reading the snapshot once.
    void subscribed.then(notify, notify);
    return () => {
      cancelled = true;
      off();
      void subscribed
        .then(() =>
          rpc.conversations.unsubscribeConversationTranscript(projectId, taskId, conversationId)
        )
        .catch(() => {});
    };
  }, [active, projectId, taskId, conversationId]);
}
