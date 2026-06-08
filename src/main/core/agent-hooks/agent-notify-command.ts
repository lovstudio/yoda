import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, win32 } from 'node:path';
import { log } from '@main/lib/logger';
import openCodePluginContent from './opencode-notifications-plugin.js?raw';

export type CodexNotifyCommandOptions = {
  platform?: NodeJS.Platform;
  writeFile?: (path: string, content: string) => void;
  mkdir?: (path: string) => void;
  scriptPath?: string;
};

const ensuredWindowsCodexNotifyScriptPaths = new Set<string>();

/**
 * POSIX snippet that reads the hook server's current `{ port, token }` from the
 * well-known endpoint file ($HOME/.yoda/hook-endpoint.json) at fire-time into
 * `YH_PORT` / `YH_TOKEN`. This survives main-process restarts: a long-lived
 * agent process always reads the *current* endpoint instead of a stale
 * `YODA_HOOK_PORT` env captured when its PTY was spawned.
 *
 * Uses only `sed` (no python, no jq) so there is no nested-quote hazard when
 * this string is embedded directly in a hook command line, and no runtime
 * dependency beyond a POSIX shell. If the file is absent, `YH_PORT` is empty
 * and the caller's `[ -n "$YH_PORT" ]` guard skips the request.
 */
function readHookEndpointSnippet(): string {
  const file = '"$HOME/.yoda/hook-endpoint.json"';
  return (
    `YH_PORT=$(sed -n 's/.*"port":\\([0-9]*\\).*/\\1/p' ${file} 2>/dev/null); ` +
    `YH_TOKEN=$(sed -n 's/.*"token":"\\([^"]*\\)".*/\\1/p' ${file} 2>/dev/null); `
  );
}

export function makeClaudeHookCommand(eventType: string): string {
  return (
    readHookEndpointSnippet() +
    '[ -n "$YH_PORT" ] && curl -sf -X POST ' +
    '-H "Content-Type: application/json" ' +
    '-H "X-Yoda-Token: $YH_TOKEN" ' +
    '-H "X-Yoda-Pty-Id: $YODA_PTY_ID" ' +
    `-H "X-Yoda-Event-Type: ${eventType}" ` +
    '-d @- ' +
    '"http://127.0.0.1:$YH_PORT/hook"; true'
  );
}

export function makeOpenCodePluginContent(): string {
  return openCodePluginContent;
}

function makePosixCodexNotifyCommand(): string[] {
  return [
    'bash',
    '-c',
    readHookEndpointSnippet() +
      '[ -n "$YH_PORT" ] && curl -sf -X POST ' +
      "-H 'Content-Type: application/json' " +
      '-H "X-Yoda-Token: $YH_TOKEN" ' +
      '-H "X-Yoda-Pty-Id: $YODA_PTY_ID" ' +
      '-H "X-Yoda-Event-Type: notification" ' +
      '-d "$1" ' +
      '"http://127.0.0.1:$YH_PORT/hook"; true',
    '_',
  ];
}

function windowsCodexNotifyScript(): string {
  return [
    'param([string]$payload)',
    'try {',
    '  Invoke-WebRequest -UseBasicParsing -Method POST ' +
      "-Uri ('http://127.0.0.1:' + $env:YODA_HOOK_PORT + '/hook') " +
      '-Headers @{ ' +
      "'Content-Type' = 'application/json'; " +
      "'X-Yoda-Token' = $env:YODA_HOOK_TOKEN; " +
      "'X-Yoda-Pty-Id' = $env:YODA_PTY_ID; " +
      "'X-Yoda-Event-Type' = 'notification' " +
      '} -Body $payload | Out-Null',
    '} catch {',
    '  exit 0',
    '}',
    '',
  ].join('\n');
}

function ensureWindowsCodexNotifyScript(options: CodexNotifyCommandOptions): string {
  const platform = options.platform ?? process.platform;
  const scriptPath = options.scriptPath ?? join(tmpdir(), 'yoda-codex-notify.ps1');
  if (ensuredWindowsCodexNotifyScriptPaths.has(scriptPath)) {
    return scriptPath;
  }

  const scriptDir = platform === 'win32' ? win32.dirname(scriptPath) : dirname(scriptPath);
  const mkdir = options.mkdir ?? ((path: string) => mkdirSync(path, { recursive: true }));
  const writeFile = options.writeFile ?? writeFileSync;

  try {
    mkdir(scriptDir);
    writeFile(scriptPath, windowsCodexNotifyScript());
    ensuredWindowsCodexNotifyScriptPaths.add(scriptPath);
  } catch (err) {
    log.warn('CodexNotifyCommand: failed to write Windows notify script', {
      path: scriptPath,
      error: String(err),
    });
  }

  return scriptPath;
}

function makeWindowsCodexNotifyCommand(options: CodexNotifyCommandOptions): string[] {
  return ['powershell.exe', '-NoProfile', '-File', ensureWindowsCodexNotifyScript(options)];
}

export function makeCodexNotifyCommand(options: CodexNotifyCommandOptions = {}): string[] {
  const platform = options.platform ?? process.platform;
  return platform === 'win32'
    ? makeWindowsCodexNotifyCommand(options)
    : makePosixCodexNotifyCommand();
}
