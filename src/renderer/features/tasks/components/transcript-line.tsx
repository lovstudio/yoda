import { cn } from '@renderer/utils/utils';

interface ParsedLine {
  summary: string;
  timestamp: string | null;
  pretty: string;
}

/** One raw JSONL line → type/subtype summary + complete pretty JSON. */
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
      summary: `${type}${subtype}${roleSuffix}`,
      timestamp: typeof row.timestamp === 'string' ? row.timestamp : null,
      pretty: JSON.stringify(row, null, 2),
    };
  } catch {
    return { summary: 'raw', timestamp: null, pretty: line };
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
export function TranscriptLineItem({ line, lineNo }: { line: string; lineNo: number }) {
  const parsed = parseLine(line);
  const time = formatTimestamp(parsed.timestamp);
  return (
    <details className="group border-b border-border/40 last:border-b-0">
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
      <pre className="overflow-x-auto whitespace-pre-wrap break-all border-t border-border/30 bg-background-1/40 px-3 py-1.5 font-mono text-[10px] leading-relaxed text-foreground-muted">
        {parsed.pretty}
      </pre>
    </details>
  );
}
