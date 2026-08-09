import { open, type FileHandle } from 'node:fs/promises';
import { classifyClaudeTranscriptVerdict, type ClaudeTurnVerdict } from './claude-run-state-source';

const COLD_TURN_SCAN_CHUNK_BYTES = 256 * 1024;
const MAX_COLD_TURN_LINE_BYTES = 2 * 1024 * 1024;
const MAX_COLD_TURN_SCAN_BYTES = 8 * 1024 * 1024;
const COLD_TURN_LINE_MARKERS = [
  Buffer.from('"stop_hook_summary"'),
  Buffer.from('"type":"user"'),
  Buffer.from('"type": "user"'),
  Buffer.from('"AskUserQuestion"'),
  Buffer.from('"ExitPlanMode"'),
  Buffer.from('"tool_result"'),
];

/**
 * Read only Claude's newest turn segment for cold-session reclamation.
 *
 * A transcript can contain very large historical tool payloads. Scanning
 * backwards stops at the newest complete user boundary, keeps memory bounded,
 * and returns no verdict if an oversized or malformed relevant row makes the
 * newest segment ambiguous. A stop row without its user row is not sufficient
 * evidence. That ambiguity must never authorize a tmux kill.
 */
export async function readClaudeColdTurnVerdictFile(
  transcriptPath: string
): Promise<ClaudeTurnVerdict | null> {
  const file = await open(transcriptPath, 'r').catch(() => undefined);
  if (!file) return null;
  try {
    const { size } = await file.stat();
    const segment = await readRecentClaudeTurnLines(file, size);
    if (!segment.complete || !segment.boundaryFound) return null;
    return classifyClaudeTranscriptVerdict(segment.lines.join('\n'));
  } finally {
    await file.close();
  }
}

type RecentClaudeTurnLines = {
  lines: string[];
  complete: boolean;
  boundaryFound: boolean;
};

async function readRecentClaudeTurnLines(
  file: FileHandle,
  size: number
): Promise<RecentClaudeTurnLines> {
  const newestFirst: string[] = [];
  let position = size;
  let scannedBytes = 0;
  let carry = Buffer.alloc(0);
  let uncertain = false;

  const collect = (line: Buffer): boolean => {
    if (line.length === 0) return false;
    if (line.length > MAX_COLD_TURN_LINE_BYTES) {
      uncertain = true;
      return false;
    }
    if (!COLD_TURN_LINE_MARKERS.some((marker) => line.includes(marker))) return false;
    const text = line.toString('utf8').trim();
    if (!text) return false;
    const boundary = isClaudeTurnBoundary(text);
    if (boundary === null) {
      uncertain = true;
      return false;
    }
    newestFirst.push(text);
    return boundary;
  };

  while (position > 0) {
    const remainingBudget = MAX_COLD_TURN_SCAN_BYTES - scannedBytes;
    if (remainingBudget <= 0) {
      return { lines: newestFirst.reverse(), complete: false, boundaryFound: false };
    }
    const start = Math.max(0, position - Math.min(COLD_TURN_SCAN_CHUNK_BYTES, remainingBudget));
    const chunk = Buffer.allocUnsafe(position - start);
    const { bytesRead } = await file.read(chunk, 0, chunk.length, start);
    if (bytesRead !== chunk.length) {
      return { lines: newestFirst.reverse(), complete: false, boundaryFound: false };
    }
    position = start;
    scannedBytes += bytesRead;
    const data = chunk.subarray(0, bytesRead);

    const lastSeparator = data.lastIndexOf(0x0a);
    if (lastSeparator < 0 && data.length + carry.length > MAX_COLD_TURN_LINE_BYTES) {
      return { lines: newestFirst.reverse(), complete: false, boundaryFound: false };
    }

    const combined = carry.length > 0 ? Buffer.concat([data, carry]) : data;
    const firstSeparator = combined.indexOf(0x0a);
    if (firstSeparator < 0) {
      carry = combined;
      continue;
    }

    let lineEnd = combined.length;
    for (let separator = combined.lastIndexOf(0x0a, lineEnd - 1); separator >= firstSeparator; ) {
      if (collect(combined.subarray(separator + 1, lineEnd))) {
        return { lines: newestFirst.reverse(), complete: !uncertain, boundaryFound: true };
      }
      if (uncertain) {
        return { lines: newestFirst.reverse(), complete: false, boundaryFound: false };
      }
      lineEnd = separator;
      if (separator === firstSeparator) break;
      separator = combined.lastIndexOf(0x0a, separator - 1);
    }
    carry = combined.subarray(0, firstSeparator);
  }

  if (carry.length > 0 && collect(carry)) {
    return { lines: newestFirst.reverse(), complete: !uncertain, boundaryFound: true };
  }
  return { lines: newestFirst.reverse(), complete: !uncertain, boundaryFound: false };
}

/**
 * `true` means this row is the oldest row needed for the current verdict;
 * `false` is relevant but not a boundary; `null` is unparseable/ambiguous.
 */
function isClaudeTurnBoundary(line: string): boolean | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const row = parsed as Record<string, unknown>;
  if (row.subtype === 'stop_hook_summary') return false;
  if (row.type !== 'user') return false;
  const message = row.message;
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as Record<string, unknown>).role === 'user'
  );
}
