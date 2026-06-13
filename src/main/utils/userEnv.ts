import { exec } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { log } from '@main/lib/logger';
import { buildExternalToolEnv } from './childProcessEnv';
import { getWindowsEnvValue, prependWindowsPathEntry } from './windows-env';

/**
 * Keys that must never be overwritten from the shell env capture.
 *
 * - AppImage runtime vars would corrupt child-process environments when
 *   running from a Linux AppImage bundle.
 * - Electron-specific vars must retain the values Electron set at boot.
 * - NODE_ENV is set by the build toolchain and must not be overridden.
 */
const PRESERVE_KEYS = new Set([
  // AppImage
  'APPDIR',
  'APPIMAGE',
  'ARGV0',
  'CHROME_DESKTOP',
  'GSETTINGS_SCHEMA_DIR',
  'OWD',
  // Electron
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'ELECTRON_ENABLE_LOGGING',
  'ELECTRON_ENABLE_STACK_DUMPING',
  // Build toolchain
  'NODE_ENV',
]);

export const SHELL_ENV_CAPTURE_GUARD: Record<string, string> = {
  DISABLE_AUTO_UPDATE: 'true',
  ZSH_TMUX_AUTOSTART: 'false',
  ZSH_TMUX_AUTOSTARTED: 'true',
};

const USER_BIN_DIRS = [path.join(os.homedir(), '.local', 'bin')];

function pathEntryExists(entry: string): boolean {
  try {
    return fs.statSync(entry).isDirectory();
  } catch {
    return false;
  }
}

// Sentinels bracket the `env` output so interactive-shell noise — powerlevel10k
// instant prompt, oh-my-zsh MOTDs, version-manager banners — printed to stdout
// before/after `env` can't pollute the parsed PATH. Mirrors VS Code's shell-env
// approach. Kept deliberately unusual to avoid colliding with real env values.
const ENV_SENTINEL_START = '__YODA_ENV_START__';
const ENV_SENTINEL_END = '__YODA_ENV_END__';

/**
 * Returns only the text between the sentinels. If a marker is missing (e.g. the
 * shell errored before reaching it) the raw input is returned unchanged so the
 * caller still gets a best-effort parse rather than nothing.
 */
function extractBetweenSentinels(raw: string): string {
  const start = raw.indexOf(ENV_SENTINEL_START);
  const end = raw.lastIndexOf(ENV_SENTINEL_END);
  if (start === -1 || end === -1 || end <= start) return raw;
  const afterStart = raw.indexOf('\n', start);
  if (afterStart === -1 || afterStart >= end) return raw;
  return raw.slice(afterStart + 1, end);
}

function parseEnvOutput(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1);
    if (key && /^[A-Za-z_]\w*$/.test(key)) {
      result[key] = value;
    }
  }
  return result;
}

function mergePath(shellPath: string, currentPath: string): string {
  const sep = process.platform === 'win32' ? ';' : ':';
  const shellEntries = shellPath.split(sep).filter(Boolean);
  const currentEntries = currentPath.split(sep).filter(Boolean);

  // Shell entries first (user's full PATH), then any Electron-only entries not in shell PATH
  const seen = new Set(shellEntries);
  const extra = currentEntries.filter((p) => !seen.has(p));
  return [...shellEntries, ...extra].join(sep);
}

export function ensureUserBinDirsInPath(candidates: string[] = USER_BIN_DIRS): string[] {
  const currentPath = process.env.PATH ?? '';
  const entries = currentPath.split(path.delimiter).filter(Boolean);
  const existing = new Set(entries);
  const additions = candidates.filter(
    (candidate) => pathEntryExists(candidate) && !existing.has(candidate)
  );

  if (additions.length === 0) {
    return [];
  }

  process.env.PATH = [...additions, ...entries].join(path.delimiter);
  return additions;
}

export function ensureWindowsNpmGlobalBinInPath(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const appData = getWindowsEnvValue(env, 'APPDATA');
  if (!appData) return null;

  const npmPath = path.win32.join(appData, 'npm');
  return prependWindowsPathEntry(env, npmPath) ? npmPath : null;
}

/**
 * Spawns `$SHELL -ilc 'env'` with a 5 s timeout. On any error (timeout,
 * missing shell, restricted environment) the function logs a warning and
 * returns — the app continues with whatever `process.env` already contains.
 *
 * After this call returns, all subsequent consumers that inherit `process.env`
 * (execFile, PTY env builders, dependency prober, etc.) automatically see the
 * full PATH, SSH_AUTH_SOCK, and other variables the user's shell init sets.
 */
export async function resolveUserEnv(): Promise<void> {
  if (process.platform === 'win32') {
    // Windows PATH is managed differently; no login-shell capture needed.
    ensureWindowsNpmGlobalBinInPath();
    return;
  }

  const shell = process.env.SHELL ?? (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  const baseEnv = buildExternalToolEnv();

  try {
    // Async exec — a heavy zsh init (mise/oh-my-zsh/starship) can take seconds,
    // and execSync here used to freeze the main process (and first paint) for
    // that whole duration.
    const raw = await new Promise<string>((resolve, reject) => {
      exec(
        // Bracket `env` with sentinels so a noisy interactive prompt can't
        // corrupt the captured PATH (see extractBetweenSentinels).
        `${shell} -ilc 'echo ${ENV_SENTINEL_START}; env; echo ${ENV_SENTINEL_END}'`,
        {
          encoding: 'utf8',
          // Heavy zsh inits (mise/oh-my-zsh/starship) routinely exceed 5s on a
          // cold start; a timeout here silently drops the user's full PATH and
          // makes every CLI probe report "missing". 10s buys that headroom.
          timeout: 10_000,
          // Route through buildExternalToolEnv so AppImage runtime vars (APPIMAGE,
          // APPDIR, ARGV0, ...) and `/tmp/.mount_*` PATH entries don't leak into
          // the probe shell. Otherwise login-shell hooks that resolve a binary by
          // name through PATH (mise/starship/oh-my-zsh) can re-enter the AppImage
          // and fork-bomb the app on Linux. See #1679.
          env: {
            ...baseEnv,
            ...SHELL_ENV_CAPTURE_GUARD,
          },
        },
        (err, stdout) => (err ? reject(err) : resolve(stdout))
      );
    });

    const shellEnv = parseEnvOutput(extractBetweenSentinels(raw));

    for (const [key, value] of Object.entries(shellEnv)) {
      if (PRESERVE_KEYS.has(key)) continue;

      if (key === 'PATH') {
        const current = baseEnv.PATH ?? '';
        process.env.PATH = mergePath(value, current);
      } else {
        process.env[key] = value;
      }
    }

    log.info('[userEnv] Resolved login-shell env', {
      shell,
      pathEntries: process.env.PATH?.split(':').length ?? 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('[userEnv] Failed to resolve login-shell env, falling back to process.env', {
      shell,
      error: message,
    });
  }
}

/**
 * Parses a remote `env` command output into a key→value map.
 * Exported for use by the SSH connection manager.
 */
export function parseRemoteEnvOutput(raw: string): Record<string, string> {
  return parseEnvOutput(raw);
}
