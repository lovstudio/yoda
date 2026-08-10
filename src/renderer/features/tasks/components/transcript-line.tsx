import { memo, useMemo, useState } from 'react';
import { cn } from '@renderer/utils/utils';

type ParsedLine =
  | {
      kind: 'json';
      summary: string;
      timestamp: string | null;
    }
  | {
      kind: 'raw';
      summary: 'raw';
      timestamp: null;
    };

/** One raw JSONL line → the summary shown while its details remain collapsed. */
function parseLine(line: string): ParsedLine {
  try {
    const row = JSON.parse(line) as Record<string, unknown>;
    const type = typeof row.type === 'string' ? row.type : '?';
    const subtype = typeof row.subtype === 'string' ? `/${row.subtype}` : '';
    const role =
      typeof row.message === 'object' && row.message !== null
        ? (row.message as Record<string, unknown>).role
        : undefined;
    const roleSuffix = typeof role === 'string' && role !== type ? ` (${role})` : '';
    return {
      kind: 'json',
      summary: `${type}${subtype}${roleSuffix}`,
      timestamp: typeof row.timestamp === 'string' ? row.timestamp : null,
    };
  } catch {
    return { kind: 'raw', summary: 'raw', timestamp: null };
  }
}

function formatTimestamp(timestamp: string | null): string | null {
  if (!timestamp) return null;
  const at = new Date(timestamp);
  return Number.isNaN(at.getTime()) ? null : at.toLocaleTimeString();
}

/**
 * One collapsible transcript row: line number + type summary + timestamp,
 * expanding to the complete pretty-printed JSON. Shared between the live
 * Transcript blind and the read-only archived-session viewer.
 */
export const TranscriptLineItem = memo(function TranscriptLineItem({
  line,
  lineNo,
}: {
  line: string;
  lineNo: number;
}) {
  const [open, setOpen] = useState(false);
  const parsed = useMemo(() => parseLine(line), [line]);
  const time = useMemo(() => formatTimestamp(parsed.timestamp), [parsed.timestamp]);
  const pretty = useMemo(() => {
    if (!open) return null;
    return parsed.kind === 'json' ? JSON.stringify(JSON.parse(line), null, 2) : line;
  }, [line, open, parsed]);

  return (
    <details
      open={open}
      className="group border-b border-border/40 last:border-b-0"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        className={cn(
          'flex cursor-pointer select-none items-baseline gap-2 px-3 py-1 text-[11px]',
          'hover:bg-background-2 [&::-webkit-details-marker]:hidden'
        )}
      >
        <span className="shrink-0 font-mono text-[10px] text-foreground-passive">{lineNo}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-foreground-muted group-open:text-foreground">
          {parsed.summary}
        </span>
        {time ? (
          <span className="shrink-0 font-mono text-[10px] text-foreground-passive">{time}</span>
        ) : null}
      </summary>
      {pretty === null ? null : (
        <pre className="overflow-x-auto whitespace-pre-wrap break-all border-t border-border/30 bg-background-1/40 px-3 py-1.5 font-mono text-[10px] leading-relaxed text-foreground-muted">
          {pretty}
        </pre>
      )}
    </details>
  );
});
