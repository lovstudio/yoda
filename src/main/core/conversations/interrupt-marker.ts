/**
 * In-memory "the user interrupted this conversation" markers.
 *
 * Needed because a Claude transcript can freeze in a `working` shape with no
 * way to ever leave it: a turn killed before its first assistant output (app
 * restart, Esc before any output — CC writes no interrupt sentinel and fires
 * no Stop hook in that window). The stateless `deriveStatus` and the live
 * transcript tailer would both re-derive `working` from that frozen transcript
 * forever, defeating any force-clear of the in-memory store.
 *
 * A marker says: transcript-`working` verdicts are stale for this conversation
 * unless the decisive prompt row is NEWER than the marker. A new user prompt
 * (decisive row after the marker) invalidates the marker automatically, so the
 * next real turn spins normally.
 *
 * Keyed by conversation id alone (UUIDs — globally unique) so the transcript
 * tailer, which doesn't know project/task, can consult it too.
 */

const markers = new Map<string, number>();

export function markInterrupted(conversationId: string, at = Date.now()): void {
  markers.set(conversationId, at);
}

/**
 * Drop the marker on a confirmed new turn (hook or PID activity) so the
 * stateless deriveStatus cannot gate the fresh `working` transition.
 */
export function clearInterruptMarker(conversationId: string): void {
  markers.delete(conversationId);
}

export function hasInterruptMarker(conversationId: string): boolean {
  return markers.has(conversationId);
}

/**
 * True when the conversation was interrupted after its last decisive prompt
 * row — i.e. a transcript-`working` verdict is stale and must read as idle.
 * Clears the marker once newer decisive activity shows up.
 */
export function isInterruptedSinceLastPrompt(
  conversationId: string,
  lastDecisiveAt: number | null
): boolean {
  const marker = markers.get(conversationId);
  if (marker === undefined) return false;
  if (lastDecisiveAt !== null && lastDecisiveAt > marker) {
    markers.delete(conversationId);
    return false;
  }
  return true;
}
