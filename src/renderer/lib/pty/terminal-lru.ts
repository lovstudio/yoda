export type TerminalLruEntry = {
  sessionId: string;
  mounted: boolean;
  /** A session preparing its renderer must survive until it can mount. */
  connecting?: boolean;
  /** Main-process state can reconstruct this frontend renderer after eviction. */
  recoverable?: boolean;
};

export function selectTerminalLruEvictions(
  entriesOldestFirst: TerminalLruEntry[],
  limit: number,
  protectedSessionId?: string
): string[] {
  const retained = [...entriesOldestFirst];
  const evicted: string[] = [];
  while (retained.length > Math.max(1, limit)) {
    const index = retained.findIndex(
      (entry) => !entry.mounted && !entry.connecting && entry.sessionId !== protectedSessionId
    );
    if (index < 0) break;
    evicted.push(retained[index].sessionId);
    retained.splice(index, 1);
  }
  return evicted;
}

/**
 * Under measured runtime pressure, release one quarter of the oldest safe
 * frontend renderers. Visible, connecting and not-yet-snapshotted terminals
 * remain protected; tmux/Agent processes are outside this cache operation.
 */
export function selectTerminalPressureEvictions(
  entriesOldestFirst: TerminalLruEntry[],
  protectedSessionId?: string
): string[] {
  const eligibleCount = entriesOldestFirst.filter(
    (entry) =>
      !entry.mounted &&
      !entry.connecting &&
      entry.recoverable === true &&
      entry.sessionId !== protectedSessionId
  ).length;
  const evictionCount = Math.max(0, Math.ceil(eligibleCount / 4));
  if (evictionCount === 0) return [];
  return entriesOldestFirst
    .filter(
      (entry) =>
        !entry.mounted &&
        !entry.connecting &&
        entry.recoverable === true &&
        entry.sessionId !== protectedSessionId
    )
    .slice(0, evictionCount)
    .map((entry) => entry.sessionId);
}
