/** Shared number/time formatting for the AI invocation log surfaces. */

export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

/** Gap since the previous step. Sub-100ms gaps read as instant. */
export function formatStepGap(sinceMs: number | null): string | null {
  if (sinceMs === null) return null;
  if (sinceMs < 100) return null;
  return `+${formatDuration(sinceMs)}`;
}
