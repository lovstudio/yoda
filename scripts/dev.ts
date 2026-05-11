// Wrapper for `electron-vite dev` that makes Ctrl+C actually quit.
// electron-vite spawns Electron as a detached child whose process group is
// isolated from the terminal, so SIGINT in the shell never reaches the
// Electron main process. This wrapper:
//   1. spawns electron-vite in its own process group
//   2. on SIGINT, sends SIGTERM to the whole group (Electron handles it via
//      `before-quit`, gets ~5s to clean up DB / PTY)
//   3. SIGKILLs the group if it didn't die in time
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const electronVite = path.join(repoRoot, 'node_modules', '.bin', 'electron-vite');

const args = process.argv.slice(2);
const child = spawn(electronVite, ['dev', ...args], {
  cwd: repoRoot,
  stdio: 'inherit',
  detached: true, // own process group so we can signal the whole tree
  env: process.env,
});

const GRACE_MS = 5000;
let shuttingDown = false;

function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) {
    // Second Ctrl+C — go straight to SIGKILL.
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* already dead */
      }
    }
    process.exit(130);
  }
  shuttingDown = true;
  if (!child.pid) {
    process.exit(0);
  }
  // Negative pid = whole process group
  try {
    process.kill(-child.pid, signal === 'SIGINT' ? 'SIGTERM' : signal);
  } catch {
    /* already dead */
  }
  setTimeout(() => {
    try {
      process.kill(-child.pid!, 'SIGKILL');
    } catch {
      /* already dead */
    }
    process.exit(130);
  }, GRACE_MS).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(128 + (signal === 'SIGTERM' ? 15 : 9));
  }
  process.exit(code ?? 0);
});
