import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { AgentSessionSource } from '@shared/conversations';

const execFileAsync = promisify(execFile);
// lsof walks the process table on macOS; busy developer machines can take over
// a second even for one exact path.
const LSOF_TIMEOUT_MS = 5_000;
const SAFE_THREAD_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Codex keeps one persistent lock file per thread and leaves the file itself in
 * place after releasing it. `lsof` therefore checks ownership, not existence.
 *
 * This is a best-effort preflight for imported local Codex sessions. A missing
 * `lsof` binary simply falls through to the CLI's own resume validation.
 */
export async function hasExternalCodexThreadWriter(
  source: AgentSessionSource | undefined
): Promise<boolean> {
  if (source?.runtimeId !== 'codex' || process.platform === 'win32') return false;
  if (!SAFE_THREAD_ID.test(source.sessionId)) return false;

  const lockPath = join(source.stateRoot, 'thread-writer-locks', `${source.sessionId}.lock`);
  try {
    const { stdout } = await execFileAsync('lsof', ['-t', lockPath], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024,
      timeout: LSOF_TIMEOUT_MS,
    });
    return hasProcessId(stdout);
  } catch (error) {
    // lsof exits 1 when no process has the file open. Some Node versions keep
    // captured stdout on the error object, so accept it if it contains a PID.
    return hasProcessId(readErrorStdout(error));
  }
}

function hasProcessId(output: string | Buffer): boolean {
  const text = Buffer.isBuffer(output) ? output.toString('utf8') : output;
  return text.split(/\s+/).some((value) => /^\d+$/.test(value) && Number.parseInt(value, 10) > 0);
}

function readErrorStdout(error: unknown): string {
  if (!error || typeof error !== 'object' || !('stdout' in error)) return '';
  const stdout = error.stdout;
  if (typeof stdout === 'string') return stdout;
  return Buffer.isBuffer(stdout) ? stdout.toString('utf8') : '';
}
