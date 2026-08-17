import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { formatLogArgs, type Level } from '@shared/logger';

const LOG_FILE_NAME = 'yoda.log';
const MAX_LOG_BYTES = 4 * 1024 * 1024;

export type LogSource = 'main' | 'renderer';

let logFilePath: string | null = null;

/**
 * Point the log sink at a directory. Called once from the main entry with
 * `app.getPath('logs')`; kept out of this module so importing the logger never
 * pulls in `electron` (243 main modules import it, including under vitest).
 */
export function setLogDirectory(directory: string): void {
  try {
    mkdirSync(directory, { recursive: true });
    logFilePath = join(directory, LOG_FILE_NAME);
  } catch {
    logFilePath = null;
  }
}

export function getLogFilePath(): string | null {
  return logFilePath;
}

function rotateIfNeeded(file: string): void {
  try {
    if (statSync(file).size < MAX_LOG_BYTES) return;
    renameSync(file, `${file}.1`);
  } catch {
    // No file yet, or another writer already rotated it: nothing to do.
  }
}

/** Append one log line. No-op until `setLogDirectory` runs; never throws. */
export function appendLogLine(source: LogSource, level: Level, input: unknown[]): void {
  const file = logFilePath;
  if (!file) return;

  rotateIfNeeded(file);
  const stamp = new Date().toISOString();
  try {
    appendFileSync(file, `${stamp} ${level.toUpperCase()} [${source}] ${formatLogArgs(input)}\n`);
  } catch {
    // Full disk or revoked permissions must not take the app down.
  }
}
