export type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function parseLogLevel(value: string | undefined): Level | undefined {
  if (!value) return undefined;
  const candidate = value.trim().toLowerCase();
  if (candidate in ORDER) return candidate as Level;
  return undefined;
}

export function resolveLogLevel(args?: { envLevel?: string; debugFlag?: boolean }): Level {
  return parseLogLevel(args?.envLevel) ?? (args?.debugFlag ? 'debug' : undefined) ?? 'warn';
}

type ConsolePipeStream = object & {
  on(event: 'error', listener: (error: unknown) => void): unknown;
};

const handledConsolePipeStreams = new WeakSet<object>();

function isBrokenConsolePipe(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const code = 'code' in error ? (error as { code?: unknown }).code : undefined;
  if (code === 'EPIPE' || code === 'EIO') return true;

  const message = error instanceof Error ? error.message : '';
  return /\b(?:EPIPE|EIO)\b/.test(message) && /\bwrite\b/i.test(message);
}

export function installBrokenConsolePipeHandler(stream: ConsolePipeStream | undefined): void {
  if (!stream || handledConsolePipeStreams.has(stream)) return;
  handledConsolePipeStreams.add(stream);

  stream.on('error', (error) => {
    if (isBrokenConsolePipe(error)) return;
    throw error;
  });
}

function writeConsole(writer: () => void): void {
  try {
    writer();
  } catch (error) {
    if (isBrokenConsolePipe(error)) return;
    throw error;
  }
}

function formatLogValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  if (typeof value !== 'object' || value === null) return String(value);

  const seen = new WeakSet<object>();
  try {
    return (
      JSON.stringify(value, (_key, entry: unknown) => {
        if (entry instanceof Error) {
          return { name: entry.name, message: entry.message, stack: entry.stack };
        }
        if (typeof entry !== 'object' || entry === null) return entry;
        if (seen.has(entry)) return '[Circular]';
        seen.add(entry);
        return entry;
      }) ?? String(value)
    );
  } catch {
    return String(value);
  }
}

/** Flatten logger arguments into one line, keeping Error stacks intact. */
export function formatLogArgs(input: unknown[]): string {
  return input.map(formatLogValue).join(' ');
}

/** Extra destination for log records that already passed the level check. */
export type LogSink = (level: Level, input: unknown[]) => void;

/** A renderer log record forwarded to the main process for persistence. */
export type RendererLogRecord = { level: Level; message: string };

export function createLogger(args?: { envLevel?: string; debugFlag?: boolean; sink?: LogSink }) {
  const level = resolveLogLevel({
    envLevel: args?.envLevel ?? import.meta.env.VITE_LOG_LEVEL,
    debugFlag: args?.debugFlag,
  });
  const sink = args?.sink;

  function enabled(target: Level): boolean {
    return ORDER[target] >= ORDER[level];
  }

  function emit(target: Level, input: unknown[], writer: () => void): void {
    if (!enabled(target)) return;
    writeConsole(writer);
    if (!sink) return;
    try {
      sink(target, input);
    } catch {
      // A log destination must never break the call site that was logging.
    }
  }

  return {
    level,
    debug: (...input: unknown[]) => emit('debug', input, () => console.debug(...input)),
    info: (...input: unknown[]) => emit('info', input, () => console.info(...input)),
    warn: (...input: unknown[]) => emit('warn', input, () => console.warn(...input)),
    error: (...input: unknown[]) => emit('error', input, () => console.error(...input)),
  };
}
