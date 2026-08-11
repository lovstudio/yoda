export type TerminalLruEntry = {
  sessionId: string;
  mounted: boolean;
  /** A session preparing its renderer must survive until it can mount. */
  connecting?: boolean;
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
