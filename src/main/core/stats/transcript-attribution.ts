export type TranscriptAttribution<T> = {
  transcriptKey: string;
  priority: number;
  value: T;
};

/**
 * One provider transcript can be reached through several legacy Yoda
 * conversations. Keep it once, preferring an exact persisted provider binding
 * over a title/time heuristic so totals and task attribution stay stable.
 */
export function dedupeTranscriptAttributions<T>(
  candidates: readonly TranscriptAttribution<T>[]
): T[] {
  const byTranscript = new Map<string, TranscriptAttribution<T>>();
  for (const candidate of candidates) {
    const current = byTranscript.get(candidate.transcriptKey);
    if (!current || candidate.priority > current.priority) {
      byTranscript.set(candidate.transcriptKey, candidate);
    }
  }
  return [...byTranscript.values()].map((candidate) => candidate.value);
}
