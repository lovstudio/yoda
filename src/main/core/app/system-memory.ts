import { execFile } from 'node:child_process';
import { freemem, totalmem } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DARWIN_MEMORY_PRESSURE_CACHE_MS = 5_000;

let darwinMemoryCache:
  | {
      expiresAt: number;
      usedPercent: number;
    }
  | undefined;

export function calculateMemoryUsedPercent(totalMemoryBytes: number, freeMemoryBytes: number) {
  if (totalMemoryBytes <= 0) return 0;
  const usedPercent = ((totalMemoryBytes - freeMemoryBytes) / totalMemoryBytes) * 100;
  return Math.round(Math.min(100, Math.max(0, usedPercent)) * 10) / 10;
}

export function parseDarwinMemoryPressureUsedPercent(output: string): number | undefined {
  const match = output.match(/System-wide memory free percentage:\s*(\d+(?:\.\d+)?)%/i);
  if (!match) return undefined;
  const freePercent = Number(match[1]);
  if (!Number.isFinite(freePercent) || freePercent < 0 || freePercent > 100) return undefined;
  return Math.round((100 - freePercent) * 10) / 10;
}

/**
 * Node's `os.freemem()` reports only immediately free pages on macOS. The OS
 * aggressively uses reclaimable memory for caches, so that value regularly
 * reads above 90% used even when memory pressure is low. Use macOS's own
 * pressure accounting there and retain the portable calculation elsewhere.
 */
export async function getSystemMemoryUsedPercent(): Promise<number> {
  const fallback = calculateMemoryUsedPercent(totalmem(), freemem());
  if (process.platform !== 'darwin') return fallback;

  const now = Date.now();
  if (darwinMemoryCache && darwinMemoryCache.expiresAt > now) {
    return darwinMemoryCache.usedPercent;
  }

  try {
    const { stdout } = await execFileAsync('/usr/bin/memory_pressure', ['-Q'], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024,
      timeout: 1_000,
    });
    const usedPercent = parseDarwinMemoryPressureUsedPercent(stdout);
    if (usedPercent === undefined) return fallback;
    darwinMemoryCache = {
      expiresAt: now + DARWIN_MEMORY_PRESSURE_CACHE_MS,
      usedPercent,
    };
    return usedPercent;
  } catch {
    return fallback;
  }
}
