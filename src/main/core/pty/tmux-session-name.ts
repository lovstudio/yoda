import type { IExecutionContext } from '@main/core/execution-context/types';
import { log } from '@main/lib/logger';

const TMUX_SESSION_PREFIX = 'yoda-';
const YODA_TMUX_SOCKET_NAME = 'yoda';

const YODA_TMUX_SERVER_ARGS = ['-L', YODA_TMUX_SOCKET_NAME, '-f', '/dev/null'] as const;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TMUX_SEND_TIMEOUT_MS = 2_000;
const TMUX_SEND_MAX_BUFFER = 4_096;

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
  environment?: Record<string, string>
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
  const prep = `${hideStatus} && ${enableMouse} && ${hideCopyModePositionOnWheel} && ${trackClient}`;
  return `(${checkExists} && ${prep} && ${attach}) || (${newSession} && ${prep} && ${attach})`;
}

export function makeTmuxSessionName(sessionId: string): string {
  const encoded = Buffer.from(sessionId, 'utf8').toString('base64url');
  return `${TMUX_SESSION_PREFIX}${encoded}`;
}

export async function killTmuxSession(ctx: IExecutionContext, sessionName: string): Promise<void> {
  try {
    await ctx.exec('tmux', [...YODA_TMUX_SERVER_ARGS, 'kill-session', '-t', sessionName]);
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
