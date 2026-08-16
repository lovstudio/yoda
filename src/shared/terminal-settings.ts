export const DEFAULT_TERMINAL_SCROLLBACK_LINES = 50_000;
export const MIN_TERMINAL_SCROLLBACK_LINES = 1_000;
export const MAX_TERMINAL_SCROLLBACK_LINES = 500_000;
export const TERMINAL_CACHE_MODES = ['auto', 'fixed'] as const;
export type TerminalCacheMode = (typeof TERMINAL_CACHE_MODES)[number];
/** Auto sizes a bounded warm frontend cache per machine and may shrink it further under pressure. */
export const DEFAULT_TERMINAL_CACHE_MODE: TerminalCacheMode = 'auto';
/** Fallback warm-cache size: the fixed-mode default, and auto's answer before the machine is known. */
export const DEFAULT_HOT_TERMINAL_LIMIT = 4;
export const MIN_HOT_TERMINAL_LIMIT = 1;
export const MAX_HOT_TERMINAL_LIMIT = 64;
export const DEFAULT_IDLE_SESSION_TIMEOUT_MINUTES = 5;
export const MAX_IDLE_SESSION_TIMEOUT_MINUTES = 120;
export const TERMINAL_SMART_PATH_OPEN_MODES = ['internal', 'external'] as const;
export type TerminalSmartPathOpenMode = (typeof TERMINAL_SMART_PATH_OPEN_MODES)[number];
export const DEFAULT_TERMINAL_SMART_PATH_OPEN_MODE: TerminalSmartPathOpenMode = 'internal';

const RING_BUFFER_BYTES_PER_LINE = 128;
const MIN_TERMINAL_RING_BUFFER_BYTES = 1024 * 1024;

export function normalizeTerminalScrollbackLines(value: unknown): number {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numeric)) return DEFAULT_TERMINAL_SCROLLBACK_LINES;

  return Math.min(
    MAX_TERMINAL_SCROLLBACK_LINES,
    Math.max(MIN_TERMINAL_SCROLLBACK_LINES, Math.floor(numeric))
  );
}

export function getTerminalRingBufferCapBytes(scrollbackLines: unknown): number {
  return Math.max(
    MIN_TERMINAL_RING_BUFFER_BYTES,
    normalizeTerminalScrollbackLines(scrollbackLines) * RING_BUFFER_BYTES_PER_LINE
  );
}

const GIB = 1024 ** 3;
/** Auto keeps roughly one warm terminal renderer per this much installed RAM. */
const AUTO_HOT_TERMINAL_BYTES_PER_SLOT = 4 * GIB;
/** A renderer is not free to run either: never outgrow half the logical cores. */
const AUTO_HOT_TERMINAL_CORES_PER_SLOT = 2;
export const MIN_AUTO_HOT_TERMINAL_LIMIT = 2;
export const MAX_AUTO_HOT_TERMINAL_LIMIT = 12;
/** Share of installed RAM the Electron working set may reach before auto sheds renderers. */
const AUTO_MEMORY_PRESSURE_SHARE = 0.2;
const MIN_AUTO_MEMORY_PRESSURE_BYTES = 1_500_000_000;
const MAX_AUTO_MEMORY_PRESSURE_BYTES = 6_000_000_000;

/** Machine limits auto mode reads; every field is optional so probes may fail. */
export type TerminalCacheCapacity = {
  totalMemoryBytes?: number;
  cpuCount?: number;
};

export type AutoTerminalCachePolicy = {
  /** Warm renderers auto keeps resident on this machine. */
  limit: number;
  /** Electron working set that starts shedding renderers below that limit. */
  memoryPressureBytes: number;
};

function positiveFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Size the auto warm cache from the machine instead of a constant. A 64 GiB
 * workstation and an 8 GiB laptop have no business keeping the same number of
 * terminal renderers alive, and the pressure threshold that protects the small
 * machine wastes most of the big one. Unknown capacity falls back to the fixed
 * defaults, because a failed probe is no reason to grow the cache.
 */
export function resolveAutoTerminalCachePolicy(
  capacity: TerminalCacheCapacity = {}
): AutoTerminalCachePolicy {
  const totalMemoryBytes = positiveFinite(capacity.totalMemoryBytes);
  if (totalMemoryBytes === null) {
    return {
      limit: DEFAULT_HOT_TERMINAL_LIMIT,
      memoryPressureBytes: MIN_AUTO_MEMORY_PRESSURE_BYTES,
    };
  }

  const cpuCount = positiveFinite(capacity.cpuCount);
  const memorySlots = Math.floor(totalMemoryBytes / AUTO_HOT_TERMINAL_BYTES_PER_SLOT);
  const cpuSlots =
    cpuCount === null
      ? Number.POSITIVE_INFINITY
      : Math.max(
          MIN_AUTO_HOT_TERMINAL_LIMIT,
          Math.floor(cpuCount / AUTO_HOT_TERMINAL_CORES_PER_SLOT)
        );

  return {
    limit: clamp(
      Math.min(memorySlots, cpuSlots),
      MIN_AUTO_HOT_TERMINAL_LIMIT,
      MAX_AUTO_HOT_TERMINAL_LIMIT
    ),
    memoryPressureBytes: clamp(
      Math.round(totalMemoryBytes * AUTO_MEMORY_PRESSURE_SHARE),
      MIN_AUTO_MEMORY_PRESSURE_BYTES,
      MAX_AUTO_MEMORY_PRESSURE_BYTES
    ),
  };
}
