import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  BROWSER_SESSION_HEALTH_TASK_SPACE_NAME,
  type BrowserSessionHealthDiagnostic,
  type BrowserSessionHealthOwnership,
} from '@shared/browser-session-health';
import { redactBrowserSessionDiagnostic } from './policy';

const RESULT_PREFIX = '__YODA_BROWSER_SESSION_HEALTH__';
const DEFAULT_COMMAND_TIMEOUT_MS = 45_000;
const MAX_CAPTURE_BYTES = 1024 * 1024;

export interface BrowserSessionCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export interface BrowserSessionCommandOptions {
  input?: string;
  timeoutMs: number;
}

export type BrowserSessionCommandRunner = (
  file: string,
  args: string[],
  options: BrowserSessionCommandOptions
) => Promise<BrowserSessionCommandResult>;

export type BrowserSessionEgoLauncher = (foreground: boolean) => Promise<void>;

export type EgoBrowserProbeResult =
  | {
      kind: 'page';
      taskSpaceId: number;
      ownership: 'agent';
      finalUrl: string;
      title: string;
    }
  | {
      kind: 'dialog';
      taskSpaceId: number;
      ownership: 'agent';
      finalUrl: string;
    }
  | {
      kind: 'waiting_user';
      taskSpaceId: number;
      ownership: Exclude<BrowserSessionHealthOwnership, 'agent'>;
    };

export type EgoBrowserControlResult =
  | {
      kind: 'handed_off' | 'resumed' | 'already_agent';
      taskSpaceId: number;
      ownership: BrowserSessionHealthOwnership;
    }
  | {
      kind: 'waiting_user';
      taskSpaceId: number;
      ownership: Exclude<BrowserSessionHealthOwnership, 'agent'>;
    }
  | { kind: 'missing'; taskSpaceId: null; ownership: 'unknown' };

export class EgoBrowserClientError extends Error {
  constructor(
    message: string,
    readonly code: BrowserSessionHealthDiagnostic['code']
  ) {
    super(redactBrowserSessionDiagnostic(message));
    this.name = 'EgoBrowserClientError';
  }
}

export interface EgoBrowserClientOptions {
  commandPath?: string;
  runCommand?: BrowserSessionCommandRunner;
  launchEgo?: BrowserSessionEgoLauncher;
  wait?: (milliseconds: number) => Promise<void>;
  commandTimeoutMs?: number;
  startupRetries?: number;
}

export function resolveEgoBrowserCommand(): string {
  const configured = process.env.EGO_BROWSER_PATH?.trim();
  if (configured) return configured;
  const userLocalBinary = join(homedir(), '.local', 'bin', 'ego-browser');
  return existsSync(userLocalBinary) ? userLocalBinary : 'ego-browser';
}

function appendLimited(current: string, chunk: Buffer | string): string {
  if (current.length >= MAX_CAPTURE_BYTES) return current;
  return (current + chunk.toString()).slice(0, MAX_CAPTURE_BYTES);
}

export const runBrowserSessionCommand: BrowserSessionCommandRunner = (file, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      settled = true;
      child.kill('SIGTERM');
      resolve({ stdout, stderr, exitCode: null, timedOut });
    }, options.timeoutMs);
    timer.unref();

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk);
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, timedOut });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(options.input ?? '', 'utf8');
  });

export const launchEgoLite: BrowserSessionEgoLauncher = async (foreground) => {
  const result = await runBrowserSessionCommand(
    '/usr/bin/open',
    foreground ? ['-a', 'ego lite'] : ['-gj', '-a', 'ego lite'],
    { timeoutMs: 5_000 }
  );
  if (result.timedOut || result.exitCode !== 0) {
    throw new EgoBrowserClientError(
      result.stderr || '启动 Ego 超时或失败。',
      result.timedOut ? 'command_timeout' : 'ego_not_running'
    );
  }
};

function ownershipFrom(value: unknown): BrowserSessionHealthOwnership {
  if (value === 'agent' || value === 'agentDelegatedToUser' || value === 'user') return value;
  return 'unknown';
}

function parseResult(stdout: string): Record<string, unknown> {
  const lines = stdout.split(/\r?\n/).filter((line) => line.startsWith(RESULT_PREFIX));
  const last = lines.at(-1);
  if (!last) {
    throw new EgoBrowserClientError('Ego 未返回可识别的结果。', 'invalid_response');
  }
  try {
    const parsed = JSON.parse(last.slice(RESULT_PREFIX.length)) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new EgoBrowserClientError('Ego 返回的结果格式有误。', 'invalid_response');
  }
}

function egoServiceUnavailable(result: BrowserSessionCommandResult): boolean {
  const output = `${result.stderr}\n${result.stdout}`.toLowerCase();
  return [
    'econnrefused',
    'failed to connect',
    'connection refused',
    'cannot connect',
    'could not connect',
    'browser service is not running',
    'ego service is not running',
    'ego lite is not running',
    'connect enoent',
    'socket hang up',
  ].some((marker) => output.includes(marker));
}

function ownershipChanged(result: BrowserSessionCommandResult): boolean {
  const output = `${result.stderr}\n${result.stdout}`.toLowerCase();
  return [
    'user is controlling',
    'user-owned',
    'not assigned to an agent',
    'task space is inactive',
    'taskspace is inactive',
  ].some((marker) => output.includes(marker));
}

function taskSpacePrelude(): string {
  const name = JSON.stringify(BROWSER_SESSION_HEALTH_TASK_SPACE_NAME);
  return `
const taskSpaceName = ${name};
const spaces = await listTaskSpaces();
const existing = spaces.find((space) => space.name === taskSpaceName || space.taskId === taskSpaceName);
`;
}

function formatScript(body: string): string {
  return `
const result = await (async () => {
${body}
})();
cliLog(${JSON.stringify(RESULT_PREFIX)} + JSON.stringify(result));
`;
}

export class EgoBrowserClient {
  private readonly commandPath: string;
  private readonly runCommand: BrowserSessionCommandRunner;
  private readonly launchEgo: BrowserSessionEgoLauncher;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly commandTimeoutMs: number;
  private readonly startupRetries: number;

  constructor(options: EgoBrowserClientOptions = {}) {
    this.commandPath = options.commandPath ?? resolveEgoBrowserCommand();
    this.runCommand = options.runCommand ?? runBrowserSessionCommand;
    this.launchEgo = options.launchEgo ?? launchEgoLite;
    this.wait =
      options.wait ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.startupRetries = Math.max(0, Math.min(5, options.startupRetries ?? 2));
  }

  async probe(url: string, navigationTimeoutMs = 30_000): Promise<EgoBrowserProbeResult> {
    const script = formatScript(`${taskSpacePrelude()}
if (existing && existing.ownership !== 'agent') {
  return { kind: 'waiting_user', taskSpaceId: existing.id, ownership: existing.ownership ?? 'unknown' };
}
const task = existing
  ? await useOrCreateTaskSpace(existing.id)
  : await useOrCreateTaskSpace(taskSpaceName);
const realTab = await ensureRealTab();
let tab = realTab;
if (realTab) {
  await gotoAndWait(${JSON.stringify(url)}, {
    timeout: ${Math.max(1, Math.ceil(navigationTimeoutMs / 1_000))},
  });
  tab = await currentTab();
} else {
  tab = await openOrReuseTab(${JSON.stringify(url)}, {
    wait: true,
    timeout: ${Math.max(1, Math.ceil(navigationTimeoutMs / 1_000))},
  });
}
const info = await pageInfo();
if (info && info.dialog) {
  return { kind: 'dialog', taskSpaceId: task.id, ownership: 'agent', finalUrl: tab?.url ?? '' };
}
return {
  kind: 'page',
  taskSpaceId: task.id,
  ownership: 'agent',
  finalUrl: info?.url ?? tab?.url ?? '',
  title: info?.title ?? '',
};`);
    const value = await this.runJsonScript(script);
    const taskSpaceId = Number(value.taskSpaceId);
    const ownership = ownershipFrom(value.ownership);
    if (!Number.isInteger(taskSpaceId) || taskSpaceId < 0) {
      throw new EgoBrowserClientError('Ego 未返回有效的 Task Space 标识。', 'invalid_response');
    }
    if (value.kind === 'waiting_user' && ownership !== 'agent') {
      return { kind: 'waiting_user', taskSpaceId, ownership };
    }
    if (value.kind === 'dialog') {
      return {
        kind: 'dialog',
        taskSpaceId,
        ownership: 'agent',
        finalUrl: String(value.finalUrl ?? ''),
      };
    }
    if (value.kind !== 'page' || ownership !== 'agent') {
      throw new EgoBrowserClientError('Ego 探针结果缺少必要字段。', 'invalid_response');
    }
    return {
      kind: 'page',
      taskSpaceId,
      ownership: 'agent',
      finalUrl: String(value.finalUrl ?? ''),
      title: String(value.title ?? ''),
    };
  }

  async handoff(): Promise<EgoBrowserControlResult> {
    const value = await this.runJsonScript(
      formatScript(`${taskSpacePrelude()}
if (!existing) return { kind: 'missing', taskSpaceId: null, ownership: 'unknown' };
if (existing.ownership !== 'agent') {
  return { kind: 'waiting_user', taskSpaceId: existing.id, ownership: existing.ownership ?? 'unknown' };
}
await useOrCreateTaskSpace(existing.id);
const handoff = await handOffTaskSpace(existing.id);
return {
  kind: handoff?.done ? 'handed_off' : 'handoff_failed',
  taskSpaceId: existing.id,
  ownership: handoff?.done ? 'agentDelegatedToUser' : 'agent',
};`)
    );
    if (value.kind === 'handoff_failed') {
      throw new EgoBrowserClientError('Ego 未完成 Task Space 交接。', 'handoff_failed');
    }
    return this.parseControlResult(value);
  }

  /** This is the only method that can call takeOverTaskSpace; service calls it after explicit RPC. */
  async resumeAfterLogin(): Promise<EgoBrowserControlResult> {
    const value = await this.runJsonScript(
      formatScript(`${taskSpacePrelude()}
if (!existing) return { kind: 'missing', taskSpaceId: null, ownership: 'unknown' };
if (existing.ownership === 'agent') {
  await useOrCreateTaskSpace(existing.id);
  return { kind: 'already_agent', taskSpaceId: existing.id, ownership: 'agent' };
}
await takeOverTaskSpace(existing.id);
const verifiedSpaces = await listTaskSpaces();
const verified = verifiedSpaces.find((space) => space.id === existing.id || space.name === taskSpaceName);
if (!verified || verified.ownership !== 'agent') {
  return {
    kind: 'waiting_user',
    taskSpaceId: existing.id,
    ownership: verified?.ownership ?? 'unknown',
  };
}
return { kind: 'resumed', taskSpaceId: verified.id, ownership: 'agent' };`)
    );
    return this.parseControlResult(value);
  }

  focusHandoff(): Promise<void> {
    return this.launchEgo(true);
  }

  private parseControlResult(value: Record<string, unknown>): EgoBrowserControlResult {
    if (value.kind === 'missing')
      return { kind: 'missing', taskSpaceId: null, ownership: 'unknown' };
    const taskSpaceId = Number(value.taskSpaceId);
    const ownership = ownershipFrom(value.ownership);
    if (!Number.isInteger(taskSpaceId) || taskSpaceId < 0) {
      throw new EgoBrowserClientError('Ego 未返回有效的 Task Space 标识。', 'invalid_response');
    }
    if (value.kind === 'waiting_user' && ownership !== 'agent') {
      return { kind: 'waiting_user', taskSpaceId, ownership };
    }
    if (
      (value.kind === 'handed_off' || value.kind === 'resumed' || value.kind === 'already_agent') &&
      ownership !== 'unknown'
    ) {
      return { kind: value.kind, taskSpaceId, ownership };
    }
    throw new EgoBrowserClientError('Ego 控制权结果格式有误。', 'invalid_response');
  }

  private async runJsonScript(script: string): Promise<Record<string, unknown>> {
    let launched = false;
    for (let attempt = 0; attempt <= this.startupRetries; attempt += 1) {
      const result = await this.runCommand(this.commandPath, ['nodejs'], {
        input: script,
        timeoutMs: this.commandTimeoutMs,
      });
      if (result.timedOut) {
        throw new EgoBrowserClientError('Ego 检查命令超时。', 'command_timeout');
      }
      if (result.exitCode === 0) return parseResult(result.stdout);
      if (ownershipChanged(result)) {
        throw new EgoBrowserClientError(
          'Ego Task Space 已由用户控制，需要显式恢复后再检查。',
          'ownership_changed'
        );
      }
      if (egoServiceUnavailable(result) && attempt < this.startupRetries) {
        if (!launched) {
          await this.launchEgo(false);
          launched = true;
        }
        await this.wait(Math.min(1_500, 300 * 2 ** attempt));
        continue;
      }
      throw new EgoBrowserClientError(
        result.stderr || result.stdout || 'Ego 检查命令执行失败。',
        egoServiceUnavailable(result) ? 'ego_not_running' : 'command_failed'
      );
    }
    throw new EgoBrowserClientError('Ego 服务未就绪。', 'ego_not_running');
  }
}
