import { createLogger, formatLogArgs, type Level, type RendererLogRecord } from '@shared/logger';

/** Only levels worth keeping after the window closes are persisted. */
const FORWARDED_LEVELS: ReadonlySet<Level> = new Set<Level>(['warn', 'error']);
const FORWARD_WINDOW_MS = 60_000;
const FORWARD_MAX_PER_WINDOW = 200;

type RendererLogForwarder = (record: RendererLogRecord) => void;

let forwarder: RendererLogForwarder | null = null;
let windowStartedAt = 0;
let windowCount = 0;

/**
 * Install the transport that persists renderer warnings. Injected from the
 * renderer entry instead of imported here so this module stays free of IPC and
 * keeps working in tests and detached windows.
 */
export function setRendererLogForwarder(next: RendererLogForwarder | null): void {
  forwarder = next;
}

function forwardRecord(level: Level, input: unknown[]): void {
  if (!forwarder || !FORWARDED_LEVELS.has(level)) return;

  const now = Date.now();
  if (now - windowStartedAt > FORWARD_WINDOW_MS) {
    windowStartedAt = now;
    windowCount = 0;
  }

  windowCount += 1;
  if (windowCount > FORWARD_MAX_PER_WINDOW) {
    // Say so once instead of dropping silently, then stay quiet for the window.
    if (windowCount === FORWARD_MAX_PER_WINDOW + 1) {
      forwarder({
        level: 'warn',
        message: `[logger] renderer log forwarding hit ${FORWARD_MAX_PER_WINDOW}/min, dropping the rest of this window`,
      });
    }
    return;
  }

  forwarder({ level, message: formatLogArgs(input) });
}

export const log = createLogger({ sink: forwardRecord });
