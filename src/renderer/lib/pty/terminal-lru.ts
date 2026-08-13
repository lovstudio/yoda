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
 * A retained floor prevents repeated pressure samples from collapsing the
 * recent-session warm window and making every task switch cold again.
 */
export function selectTerminalPressureEvictions(
  entriesOldestFirst: TerminalLruEntry[],
  protectedSessionId?: string,
  minimumRetained = 1
): string[] {
  const eligible = entriesOldestFirst.filter(
    (entry) =>
      !entry.mounted &&
      !entry.connecting &&
      entry.recoverable === true &&
      entry.sessionId !== protectedSessionId
  );
  const retentionBudget = Math.max(0, entriesOldestFirst.length - Math.max(1, minimumRetained));
  const evictionCount = Math.min(Math.ceil(eligible.length / 4), retentionBudget);
  if (evictionCount === 0) return [];
  return eligible.slice(0, evictionCount).map((entry) => entry.sessionId);
}
