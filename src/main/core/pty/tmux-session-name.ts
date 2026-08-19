import type { ExecOptions, IExecutionContext } from '@main/core/execution-context/types';
import { log } from '@main/lib/logger';

const TMUX_SESSION_PREFIX = 'yoda-';
const YODA_TMUX_SOCKET_NAME = 'yoda';

const YODA_TMUX_SERVER_ARGS = ['-L', YODA_TMUX_SOCKET_NAME, '-f', '/dev/null'] as const;
const YODA_TMUX_CLIENT_FEATURES = ['-T', 'sync'] as const;
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
const TMUX_MARKER_MISMATCH_OUTPUT = '__YODA_TMUX_MARKER_MISMATCH__';

export type TmuxSessionMarker = {
  sessionName: string;
  cwd: string;
  /** Root process inside the pane, used to attribute resources to this tmux session. */
  panePid?: number;
  /** Unix epoch milliseconds reported by tmux for the session creation time. */
  createdAtMs?: number;
  /** Unix epoch milliseconds reported by tmux for the latest session activity. */
  lastActivityAtMs?: number;
  /** Number of clients currently attached to the session. */
  attachedClients: number;
};

function tmuxShellPrefix(): string {
  return ['tmux', ...YODA_TMUX_SERVER_ARGS].join(' ');
}

function tmuxCommandShellLine(command: string): string {
  return `${tmuxShellPrefix()} ${command}`;
}

function tmuxAttachShellLine(command: string): string {
  // The agent TUI may use synchronized updates internally, but tmux consumes
  // those markers. Advertise support on Yoda's outer client so tmux restores
  // an atomic frame boundary around the redraw it forwards to the PTY. tmux
  // 3.2 and 3.3 encode that feature with a legacy DCS sequence unsupported by
  // xterm.js; 3.4+ uses DEC mode 2026. Query the running server (which can
  // outlive a binary upgrade) and retain the original attach path otherwise.
  const synchronizedAttach = `${tmuxShellPrefix()} ${YODA_TMUX_CLIENT_FEATURES.join(' ')} ${command}`;
  const compatibleAttach = tmuxCommandShellLine(command);
  const readServerVersion = tmuxCommandShellLine(
    `display-message -p ${JSON.stringify('#{version}')}`
  );
  const supportsDecSynchronizedOutput =
    `${readServerVersion} 2>/dev/null | ` +
    `awk '{ split($1, version, "."); major = version[1] + 0; minor = version[2] + 0; ` +
    `supported = major > 3 || (major == 3 && minor >= 4) } ` +
    `END { exit supported ? 0 : 1 }'`;
  return `if ${supportsDecSynchronizedOutput}; then ${synchronizedAttach}; else ${compatibleAttach}; fi`;
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
  compatibleSessionIdentities: string[] = [],
  reattachExistingSession: boolean = false
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
  const attach = tmuxAttachShellLine(`attach-session -t ${quotedName}`);
  const markIdentity = sessionIdentity
    ? tmuxCommandShellLine(
        `set-option -t ${quotedName} ${YODA_TMUX_SESSION_IDENTITY_OPTION} ${quotePosixValue(sessionIdentity)}`
      )
    : null;
  const prep = [hideStatus, enableMouse, hideCopyModePositionOnWheel, trackClient, markIdentity]
    .filter((command): command is string => command !== null)
    .join(' && ');
  const createAndAttach = `${newSession} && ${prep} && ${attach}`;

  // Startup hydration only sets this flag after inspecting Yoda's isolated
  // tmux server and finding this exact canonical session name. The agent in
  // that pane is still running, so treat it as authoritative. If it disappears
  // before this shell reaches tmux, fail this attach attempt and leave the
  // pending prompt intact; creating here would run a new command with the old
  // delivery-attempt window and could send the first prompt twice.
  if (reattachExistingSession) {
    return `if ${checkExists}; then ${attach}; else exit 75; fi`;
  }
  if (!sessionIdentity) {
    return `(${checkExists} && ${prep} && ${attach}) || (${createAndAttach})`;
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
    return await listTmuxSessionMarkersStrict(ctx);
  } catch {
    // No Yoda tmux server is the normal "nothing to hydrate" state.
    return [];
  }
}

/** List Yoda markers while preserving timeout/transport failures for GC callers. */
export async function listTmuxSessionMarkersStrict(
  ctx: IExecutionContext
): Promise<TmuxSessionMarker[]> {
  let stdout: string;
  try {
    ({ stdout } = await ctx.exec(
      'tmux',
      [
        ...YODA_TMUX_SERVER_ARGS,
        'list-panes',
        '-a',
        '-F',
        [
          '#{session_name}',
          '#{pane_current_path}',
          '#{pane_pid}',
          '#{session_created}',
          '#{session_activity}',
          '#{session_attached}',
        ].join(TMUX_LIST_FORMAT_SEPARATOR),
      ],
      { timeout: TMUX_LIST_TIMEOUT_MS, maxBuffer: TMUX_LIST_MAX_BUFFER }
    ));
  } catch (error) {
    const detail = [
      error instanceof Error ? error.message : String(error),
      typeof error === 'object' && error && 'stderr' in error ? String(error.stderr) : '',
    ].join('\n');
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
    if (
      code === 'ENOENT' ||
      /no server running(?: on )?/i.test(detail) ||
      /(?:error|failed) connecting to .*no such file or directory/i.test(detail)
    ) {
      // No tmux binary on PATH means there can be no live Yoda tmux sessions.
      return [];
    }
    throw error;
  }
  const markers = new Map<string, TmuxSessionMarker>();
  for (const line of stdout.split('\n')) {
    const [
      sessionNameValue,
      cwdValue,
      panePidValue,
      createdAtSecondsValue,
      lastActivityAtSecondsValue,
      attachedClientsValue,
    ] = line.split(TMUX_LIST_OUTPUT_SEPARATOR);
    const sessionName = sessionNameValue?.trim();
    if (!sessionName || !decodeTmuxSessionName(sessionName) || markers.has(sessionName)) continue;
    const panePid = Number(panePidValue);
    const createdAtSeconds = Number(createdAtSecondsValue);
    const lastActivityAtSeconds = Number(lastActivityAtSecondsValue);
    const attachedClients = Number(attachedClientsValue);
    markers.set(sessionName, {
      sessionName,
      cwd: cwdValue?.trim() ?? '',
      ...(Number.isSafeInteger(panePid) && panePid > 0 ? { panePid } : {}),
      ...(Number.isSafeInteger(createdAtSeconds) && createdAtSeconds > 0
        ? { createdAtMs: createdAtSeconds * 1_000 }
        : {}),
      ...(Number.isSafeInteger(lastActivityAtSeconds) && lastActivityAtSeconds > 0
        ? { lastActivityAtMs: lastActivityAtSeconds * 1_000 }
        : {}),
      attachedClients:
        Number.isSafeInteger(attachedClients) && attachedClients > 0 ? attachedClients : 0,
    });
  }
  return [...markers.values()];
}

/**
 * Report whether a Yoda-owned tmux session still hosts a running pane.
 *
 * The PTY Yoda spawns is only an `attach-session` wrapper: the Agent process
 * lives in the tmux pane and outlives every client. So a dead PTY proves the
 * transport died, never that the Agent died — only tmux can answer that.
 * Probe failures resolve to `false` so callers keep their previous, safer
 * "the backend is gone" behaviour instead of pinning a session as live forever.
 */
export async function isTmuxSessionAgentAlive(
  ctx: IExecutionContext,
  sessionName: string
): Promise<boolean> {
  try {
    const { stdout } = await ctx.exec(
      'tmux',
      [...YODA_TMUX_SERVER_ARGS, 'list-panes', '-t', sessionName, '-F', '#{pane_dead}'],
      { timeout: TMUX_LIST_TIMEOUT_MS, maxBuffer: TMUX_LIST_MAX_BUFFER }
    );
    return stdout.split('\n').some((line) => line.trim() === '0');
  } catch (error) {
    log.debug('isTmuxSessionAgentAlive: tmux session unavailable', {
      sessionName,
      error: String(error),
    });
    return false;
  }
}

export async function killTmuxSession(
  ctx: IExecutionContext,
  sessionName: string,
  execOptions?: Pick<ExecOptions, 'signal' | 'timeout'>
): Promise<void> {
  try {
    await killTmuxSessionStrict(ctx, sessionName, execOptions);
  } catch (err) {
    log.debug('killTmuxSession: tmux session not found or already dead', {
      sessionName,
      error: String(err),
    });
  }
}

/**
 * Kill a Yoda tmux session while preserving execution failures for callers
 * that must distinguish an idempotent miss from a failed reclamation.
 */
export async function killTmuxSessionStrict(
  ctx: IExecutionContext,
  sessionName: string,
  execOptions?: Pick<ExecOptions, 'signal' | 'timeout'>
): Promise<void> {
  const args = [...YODA_TMUX_SERVER_ARGS, 'kill-session', '-t', sessionName];
  await ctx.exec('tmux', args, { timeout: TMUX_KILL_TIMEOUT_MS, ...execOptions });
}

export type ConditionalTmuxKillResult = 'killed' | 'skipped';

/**
 * Atomically compare and kill inside the isolated local Yoda tmux server.
 * A same-name session recreated between inventory and cleanup is a normal
 * `skipped` result; transport/command failures remain observable to callers.
 */
export async function killTmuxSessionIfMarkerMatchesStrict(
  ctx: IExecutionContext,
  marker: TmuxSessionMarker,
  execOptions?: Pick<ExecOptions, 'signal' | 'timeout'>
): Promise<ConditionalTmuxKillResult> {
  if (
    marker.panePid === undefined ||
    marker.createdAtMs === undefined ||
    marker.lastActivityAtMs === undefined
  ) {
    return 'skipped';
  }
  const createdCheck = `#{==:#{session_created},${marker.createdAtMs / 1_000}}`;
  const activityCheck = `#{==:#{session_activity},${marker.lastActivityAtMs / 1_000}}`;
  const panePidCheck = `#{==:#{pane_pid},${marker.panePid}}`;
  const attachedCheck = `#{==:#{session_attached},${marker.attachedClients}}`;
  const condition = [activityCheck, panePidCheck, attachedCheck].reduce(
    (left, right) => `#{&&:${left},${right}}`,
    createdCheck
  );
  const killCommand = `kill-session -t ${JSON.stringify(marker.sessionName)}`;
  const mismatchCommand = `display-message -p ${JSON.stringify(TMUX_MARKER_MISMATCH_OUTPUT)}`;
  const { stdout } = await ctx.exec(
    'tmux',
    [
      ...YODA_TMUX_SERVER_ARGS,
      'if-shell',
      '-t',
      marker.sessionName,
      '-F',
      condition,
      killCommand,
      mismatchCommand,
    ],
    { timeout: TMUX_KILL_TIMEOUT_MS, ...execOptions }
  );
  return stdout.includes(TMUX_MARKER_MISMATCH_OUTPUT) ? 'skipped' : 'killed';
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
