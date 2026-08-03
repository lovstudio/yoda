import type { ExecOptions, IExecutionContext } from '@main/core/execution-context/types';
import { log } from '@main/lib/logger';

const TMUX_SESSION_PREFIX = 'yoda-';
const YODA_TMUX_SOCKET_NAME = 'yoda';

const YODA_TMUX_SERVER_ARGS = ['-L', YODA_TMUX_SOCKET_NAME, '-f', '/dev/null'] as const;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TMUX_SEND_TIMEOUT_MS = 2_000;
const TMUX_SEND_MAX_BUFFER = 4_096;
export const TMUX_KILL_TIMEOUT_MS = 2_000;
const TMUX_LIST_TIMEOUT_MS = 2_000;
const TMUX_LIST_MAX_BUFFER = 128 * 1024;
const TMUX_LIST_FORMAT_SEPARATOR = '\u001f';
// tmux renders control bytes in format output using their octal escape.
const TMUX_LIST_OUTPUT_SEPARATOR = '\\037';
const YODA_TMUX_SESSION_IDENTITY_OPTION = '@yoda_agent_session_id';

export type TmuxSessionMarker = {
  sessionName: string;
  cwd: string;
  /** Root process inside the pane, used to attribute resources to this tmux session. */
  panePid?: number;
};

function tmuxShellPrefix(): string {
  return ['tmux', ...YODA_TMUX_SERVER_ARGS].join(' ');
}

function tmuxCommandShellLine(command: string): string {
  return `${tmuxShellPrefix()} ${command}`;
}

function quotePosixValue(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildEnvironmentPrefix(environment?: Record<string, string>): string {
  const entries = Object.entries(environment ?? {}).filter(([key]) => ENV_NAME_PATTERN.test(key));
  if (entries.length === 0) return '';
  return entries.map(([key, value]) => `export ${key}=${quotePosixValue(value)};`).join(' ') + ' ';
}

export function buildTmuxShellLine(
  sessionName: string,
  commandLine: string,
  size?: { cols: number; rows: number },
  environment?: Record<string, string>,
  sessionIdentity?: string,
  compatibleSessionIdentities: string[] = []
): string {
  const quotedName = JSON.stringify(sessionName);
  // Single-quote (not JSON.stringify): JSON escapes a real newline into the
  // two characters `\n`, which POSIX double quotes pass through literally —
  // multiline prompts would reach the CLI as literal "\n" text.
  const quotedCmd = quotePosixValue(`${buildEnvironmentPrefix(environment)}${commandLine}`);
  const paneMouseFormat = JSON.stringify('#{||:#{pane_in_mode},#{mouse_any_flag}}');
  // Create the window at the client's real size so tmux draws at the same width
  // xterm renders at. Without this, `new-session -d` is born at tmux's default
  // (often 80 cols) and only resizes on attach — during that handshake tmux and
  // xterm briefly disagree on width, and because tmux positions every cell
  // absolutely the mismatch corrupts wrapping/indentation until a manual resize.
  const sizeFlags =
    size && size.cols > 0 && size.rows > 0
      ? ` -x ${Math.floor(size.cols)} -y ${Math.floor(size.rows)}`
      : '';
  const checkExists = `${tmuxCommandShellLine(`has-session -t ${quotedName}`)} 2>/dev/null`;
  const newSession = tmuxCommandShellLine(
    `new-session -d${sizeFlags} -s ${quotedName} ${quotedCmd}`
  );
  const hideStatus = tmuxCommandShellLine(`set-option -t ${quotedName} status off`);
  const enableMouse = tmuxCommandShellLine(`set-option -t ${quotedName} mouse on`);
  const hideCopyModePositionOnWheel = tmuxCommandShellLine(
    [
      'bind-key -T root WheelUpPane if-shell -F',
      paneMouseFormat,
      JSON.stringify('send-keys -M'),
      JSON.stringify('copy-mode -H -e'),
    ].join(' ')
  );
  // Window tracks the latest attached client; the attached pane resizes with it.
  const trackClient = tmuxCommandShellLine(
    `set-window-option -t ${quotedName} aggressive-resize on`
  );
  const attach = tmuxCommandShellLine(`attach-session -t ${quotedName}`);
  const markIdentity = sessionIdentity
    ? tmuxCommandShellLine(
        `set-option -t ${quotedName} ${YODA_TMUX_SESSION_IDENTITY_OPTION} ${quotePosixValue(sessionIdentity)}`
      )
    : null;
  const prep = [hideStatus, enableMouse, hideCopyModePositionOnWheel, trackClient, markIdentity]
    .filter((command): command is string => command !== null)
    .join(' && ');
  if (!sessionIdentity) {
    return `(${checkExists} && ${prep} && ${attach}) || (${newSession} && ${prep} && ${attach})`;
  }

  // A Yoda app restart reconnects to the stable tmux name. Codex rollbacks,
  // however, can move the conversation to a newer fork while the surviving
  // tmux pane still runs the old root thread. Attaching that pane silently
  // ignores the freshly resolved `resume <current-thread>` command. Persist an
  // explicit identity and replace only a pane that belongs to another thread.
  // For sessions created before this marker existed, inspect the original pane
  // command once so an already-correct live process is preserved and upgraded.
  const readIdentity = tmuxCommandShellLine(
    `show-options -v -t ${quotedName} ${YODA_TMUX_SESSION_IDENTITY_OPTION}`
  );
  const readPaneCommand = tmuxCommandShellLine(
    `list-panes -t ${quotedName} -F ${JSON.stringify('#{pane_start_command}')}`
  );
  const killSession = tmuxCommandShellLine(`kill-session -t ${quotedName}`);
  const acceptedIdentities = [sessionIdentity, ...compatibleSessionIdentities].filter(
    (identity, index, identities) => identity && identities.indexOf(identity) === index
  );
  const markedIdentityMatches = acceptedIdentities
    .map((identity) => `[ "$current_identity" = ${quotePosixValue(identity)} ]`)
    .join(' || ');
  const legacyPaneMatches = acceptedIdentities
    .map(
      (identity) =>
        `{ [ -z "$current_identity" ] && ${readPaneCommand} 2>/dev/null | grep -F -- ${quotePosixValue(identity)} >/dev/null; }`
    )
    .join(' || ');
  const identityMatches = `${markedIdentityMatches} || ${legacyPaneMatches}`;
  const createAndAttach = `${newSession} && ${prep} && ${attach}`;
  return (
    `if ${checkExists}; then ` +
    `current_identity="$(${readIdentity} 2>/dev/null || true)"; ` +
    `if ${identityMatches}; then ${prep} && ${attach}; ` +
    `else (${killSession} 2>/dev/null || true) && ${createAndAttach}; fi; ` +
    `else ${createAndAttach}; fi`
  );
}

export function makeTmuxSessionName(sessionId: string): string {
  const encoded = Buffer.from(sessionId, 'utf8').toString('base64url');
  return `${TMUX_SESSION_PREFIX}${encoded}`;
}

/** Decode only canonical Yoda-owned tmux names. */
export function decodeTmuxSessionName(sessionName: string): string | undefined {
  if (!sessionName.startsWith(TMUX_SESSION_PREFIX)) return undefined;
  const encoded = sessionName.slice(TMUX_SESSION_PREFIX.length);
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return undefined;
  try {
    const sessionId = Buffer.from(encoded, 'base64url').toString('utf8');
    return makeTmuxSessionName(sessionId) === sessionName ? sessionId : undefined;
  } catch {
    return undefined;
  }
}

/**
 * List the lightweight system markers for sessions that survived a renderer or
 * app restart. One pane is created per Yoda session; dedupe defensively in case
 * a user added another pane.
 */
export async function listTmuxSessionMarkers(ctx: IExecutionContext): Promise<TmuxSessionMarker[]> {
  try {
    const { stdout } = await ctx.exec(
      'tmux',
      [
        ...YODA_TMUX_SERVER_ARGS,
        'list-panes',
        '-a',
        '-F',
        `#{session_name}${TMUX_LIST_FORMAT_SEPARATOR}#{pane_current_path}${TMUX_LIST_FORMAT_SEPARATOR}#{pane_pid}`,
      ],
      { timeout: TMUX_LIST_TIMEOUT_MS, maxBuffer: TMUX_LIST_MAX_BUFFER }
    );
    const markers = new Map<string, TmuxSessionMarker>();
    for (const line of stdout.split('\n')) {
      const [sessionNameValue, cwdValue, panePidValue] = line.split(TMUX_LIST_OUTPUT_SEPARATOR);
      const sessionName = sessionNameValue?.trim();
      if (!sessionName || !decodeTmuxSessionName(sessionName) || markers.has(sessionName)) continue;
      const panePid = Number(panePidValue);
      markers.set(sessionName, {
        sessionName,
        cwd: cwdValue?.trim() ?? '',
        ...(Number.isSafeInteger(panePid) && panePid > 0 ? { panePid } : {}),
      });
    }
    return [...markers.values()];
  } catch {
    // No Yoda tmux server is the normal "nothing to hydrate" state.
    return [];
  }
}

export async function killTmuxSession(
  ctx: IExecutionContext,
  sessionName: string,
  execOptions?: Pick<ExecOptions, 'signal' | 'timeout'>
): Promise<void> {
  try {
    const args = [...YODA_TMUX_SERVER_ARGS, 'kill-session', '-t', sessionName];
    await ctx.exec('tmux', args, { timeout: TMUX_KILL_TIMEOUT_MS, ...execOptions });
  } catch (err) {
    log.debug('killTmuxSession: tmux session not found or already dead', {
      sessionName,
      error: String(err),
    });
  }
}

export async function sendLiteralToTmuxSession(
  ctx: IExecutionContext,
  sessionName: string,
  data: string
): Promise<void> {
  await ctx.exec('tmux', [...YODA_TMUX_SERVER_ARGS, 'send-keys', '-t', sessionName, '-l', data], {
    timeout: TMUX_SEND_TIMEOUT_MS,
    maxBuffer: TMUX_SEND_MAX_BUFFER,
  });
}
