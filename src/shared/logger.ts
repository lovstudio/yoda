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

export function createLogger(args?: { envLevel?: string; debugFlag?: boolean }) {
  const level = resolveLogLevel({
    envLevel: args?.envLevel ?? import.meta.env.VITE_LOG_LEVEL,
    debugFlag: args?.debugFlag,
  });

  function enabled(target: Level): boolean {
    return ORDER[target] >= ORDER[level];
  }

  return {
    level,
    debug: (...input: unknown[]) => {
      if (enabled('debug')) writeConsole(() => console.debug(...input));
    },
    info: (...input: unknown[]) => {
      if (enabled('info')) writeConsole(() => console.info(...input));
    },
    warn: (...input: unknown[]) => {
      if (enabled('warn')) writeConsole(() => console.warn(...input));
    },
    error: (...input: unknown[]) => {
      writeConsole(() => console.error(...input));
    },
  };
}
