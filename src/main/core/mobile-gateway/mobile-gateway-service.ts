import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';
import { app } from 'electron';
import {
  buildPromptInjectionPayload,
  getAgentCommandSubmitDelayMs,
  getAgentCommandSubmitInput,
} from '@shared/agent-command-prefix';
import type { Conversation } from '@shared/conversations';
import type { AgentSessionRuntimeStatus } from '@shared/events/agentEvents';
import {
  createExpoGoPairingUrl,
  createMobilePairingUrl,
  MOBILE_APP_DEFAULT_INSTALL_URL,
  MOBILE_GATEWAY_DEFAULT_DEV_TOKEN,
  MOBILE_GATEWAY_DEFAULT_PORT,
  MOBILE_SESSION_CONTENT_MAX_CHARS,
  MOBILE_SESSION_INPUT_MAX_CHARS,
  type MobileApiError,
  type MobileCreateDemandRequest,
  type MobileCreateDemandResponse,
  type MobileDashboardSnapshot,
  type MobileGatewayConnectionInfo,
  type MobileProjectSummary,
  type MobileSessionContentSource,
  type MobileSessionDetail,
  type MobileSessionInputRequest,
  type MobileSessionInputResponse,
  type MobileSessionSummary,
  type MobileSessionTranscriptBlock,
  type MobileTaskActivityStatus,
  type MobileTaskSessionsResponse,
  type MobileTaskSummary,
} from '@shared/mobile-api';
import {
  INTERNAL_PROJECT_ID,
  projectDisplayName,
  type OpenProjectError,
  type Project,
} from '@shared/projects';
import { makePtySessionId } from '@shared/ptySessionId';
import { RUNTIME_IDS, type RuntimeId } from '@shared/runtime-registry';
import { ensureUniqueTaskSlug, taskNameFromPrompt } from '@shared/task-name';
import type { CreateTaskError, CreateTaskWarning, Task } from '@shared/tasks';
import { loadClaudeTranscript } from '@main/core/conversations/claude-transcript';
import {
  loadCodexRolloutTerminalHistoryForConversation,
  loadCodexRolloutTranscriptForConversation,
} from '@main/core/conversations/codex-rollout-terminal-history';
import { getConversationRuntimeStatuses } from '@main/core/conversations/getConversationRuntimeStatuses';
import { getConversationSessionInfo } from '@main/core/conversations/getConversationSessionInfo';
import { getConversationsForTask } from '@main/core/conversations/getConversationsForTask';
import { getProjectById, getProjects } from '@main/core/projects/operations/getProjects';
import { openProject } from '@main/core/projects/operations/openProject';
import { projectManager } from '@main/core/projects/project-manager';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { appSettingsService } from '@main/core/settings/settings-service';
import { generateTaskName } from '@main/core/tasks/name-generation/generateTaskName';
import { createTask } from '@main/core/tasks/operations/createTask';
import { getTasks } from '@main/core/tasks/operations/getTasks';
import { taskManager } from '@main/core/tasks/task-manager';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { log } from '@main/lib/logger';

const MAX_BODY_BYTES = 128 * 1024;
const MOBILE_METRO_DEFAULT_PORT = 8081;
const METRO_STATUS_TIMEOUT_MS = 1000;

type MetroStatus = 'free' | 'occupied' | 'running';

type TaskSessionData = {
  cwd: string;
  conversations: Conversation[];
  sessions: MobileSessionSummary[];
};

class MobileGatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function parseBooleanSetting(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

function shouldStartGateway(): boolean {
  if (parseBooleanSetting(process.env.YODA_MOBILE_GATEWAY_DISABLED) === true) return false;

  const enabled = parseBooleanSetting(process.env.YODA_MOBILE_GATEWAY_ENABLED);
  if (enabled !== undefined) return enabled;

  const legacyEnabled = parseBooleanSetting(process.env.YODA_MOBILE_GATEWAY);
  return legacyEnabled !== false;
}

function isDevelopment(): boolean {
  return process.env.NODE_ENV !== 'production';
}

function metroPidFilePath(): string {
  return path.join(app.getPath('userData'), 'metro-dev-server.pid');
}

function writeMetroPidFile(pid: number): void {
  try {
    fs.writeFileSync(metroPidFilePath(), String(pid), 'utf8');
  } catch (error) {
    log.warn('MobileGateway: failed to write Metro pid file', { error: String(error) });
  }
}

function removeMetroPidFile(): void {
  try {
    fs.rmSync(metroPidFilePath(), { force: true });
  } catch (error) {
    log.warn('MobileGateway: failed to remove Metro pid file', { error: String(error) });
  }
}

function isOurMetroProcess(pid: number): boolean {
  const result = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
  if (result.status !== 0) return false;
  return result.stdout.includes('@yoda/mobile');
}

// A previous Yoda instance that crashed or was force-killed leaves its detached
// Metro process group orphaned (and getMetroStatus() would happily adopt it
// forever). Kill it before we check the port, so the orphan never outlives the
// next launch.
function killStaleMetroFromPidFile(): void {
  if (process.platform === 'win32') return;

  let pid: number;
  try {
    pid = Number.parseInt(fs.readFileSync(metroPidFilePath(), 'utf8').trim(), 10);
  } catch {
    return;
  }
  if (!Number.isInteger(pid) || pid <= 1) {
    removeMetroPidFile();
    return;
  }

  if (isOurMetroProcess(pid)) {
    log.info('MobileGateway: killing stale Expo Metro from previous run', { pid });
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        log.warn('MobileGateway: failed to kill stale Expo Metro', {
          pid,
          error: String(error),
        });
      }
    }
  }
  removeMetroPidFile();
}

function shouldAutoStartLocalMetro(): boolean {
  if (!isDevelopment()) return false;
  if (parseBooleanSetting(process.env.YODA_MOBILE_METRO_DISABLED) === true) return false;
  return !process.env.YODA_MOBILE_EXPO_URL?.trim();
}

function parsePort(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 65535) {
    return MOBILE_GATEWAY_DEFAULT_PORT;
  }
  return parsed;
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Yoda-Mobile-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify(body));
}

function writeError(res: http.ServerResponse, error: MobileGatewayError): void {
  const body: MobileApiError = {
    error: {
      code: error.code,
      message: error.message,
    },
  };
  writeJson(res, error.status, body);
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
      if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
        reject(new MobileGatewayError(413, 'body_too_large', 'Request body is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new MobileGatewayError(400, 'invalid_json', 'Request body must be valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function pathSegments(pathname: string): string[] {
  try {
    return pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    throw new MobileGatewayError(400, 'invalid_path', 'Request path is not valid.');
  }
}

function stripTerminalControlSequences(value: string): string {
  return value
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1bP[\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b_[\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\^[\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[()*+\-./][0-9A-Za-z]/g, '')
    .replace(/\x1b[=>78MDEHc]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r/g, '');
}

function removeTerminalChrome(value: string): string {
  return value
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (/^[─━╌╍┄┈\-_\s]{24,}$/.test(trimmed)) return false;
      if (/^Tip:\s+Connect Claude to your IDE\b/.test(trimmed)) return false;
      if (/\b(?:Musing|tokens?|bypass permissions|shift\+tab to cycle)\b/i.test(trimmed)) {
        return false;
      }
      if (/\b(?:Opus|Sonnet|Haiku)\b.*\banthropic\b/i.test(trimmed)) return false;
      if (/^[✢✳✶✻✽⏺⏵⎿◆◇●○·\s\dA-Za-z()./:@$,_-]+$/.test(trimmed) && trimmed.length > 80) {
        return false;
      }
      return true;
    })
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function tailSessionContent(value: string): {
  content: string;
  contentLength: number;
  truncated: boolean;
} {
  const content = removeTerminalChrome(stripTerminalControlSequences(value));
  const truncated = content.length > MOBILE_SESSION_CONTENT_MAX_CHARS;
  return {
    content: truncated ? content.slice(-MOBILE_SESSION_CONTENT_MAX_CHARS) : content,
    contentLength: content.length,
    truncated,
  };
}

function compareConversations(a: Conversation, b: Conversation): number {
  if (a.isInitialConversation === true && b.isInitialConversation !== true) return -1;
  if (a.isInitialConversation !== true && b.isInitialConversation === true) return 1;
  const aTime = Date.parse(a.lastInteractedAt ?? a.updatedAt ?? a.createdAt ?? '');
  const bTime = Date.parse(b.lastInteractedAt ?? b.updatedAt ?? b.createdAt ?? '');
  return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
}

function lanUrls(port: number): string[] {
  const urls: string[] = [];
  for (const iface of Object.values(networkInterfaces())) {
    for (const entry of iface ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        urls.push(`http://${entry.address}:${port}`);
      }
    }
  }
  return urls;
}

function mobileInstallUrl(): string {
  return process.env.YODA_MOBILE_INSTALL_URL?.trim() || MOBILE_APP_DEFAULT_INSTALL_URL;
}

function mobileGatewayToken(): string {
  const envToken = process.env.YODA_MOBILE_GATEWAY_TOKEN?.trim();
  if (envToken) return envToken;
  if (isDevelopment()) return MOBILE_GATEWAY_DEFAULT_DEV_TOKEN;
  return randomUUID();
}

function localExpoUrl(primaryUrl: string, token: string): string | null {
  const override = process.env.YODA_MOBILE_EXPO_URL?.trim();
  if (override) return createExpoGoPairingUrl(override, { baseUrl: primaryUrl, token });
  if (!isDevelopment()) return null;

  try {
    const host = new URL(primaryUrl).hostname;
    if (!host || host === 'localhost' || host === '127.0.0.1') return null;
    return createExpoGoPairingUrl(`exp://${host}:8081`, { baseUrl: primaryUrl, token });
  } catch {
    return null;
  }
}

function metroHostFromGatewayUrl(primaryUrl: string): string | null {
  try {
    const host = new URL(primaryUrl).hostname;
    if (!host || host === 'localhost' || host === '127.0.0.1') return null;
    return host;
  } catch {
    return null;
  }
}

function getMetroStatus(port = MOBILE_METRO_DEFAULT_PORT): Promise<MetroStatus> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (status: MetroStatus) => {
      if (settled) return;
      settled = true;
      resolve(status);
    };

    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path: '/status',
        timeout: METRO_STATUS_TIMEOUT_MS,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => {
          settle(body.includes('packager-status:running') ? 'running' : 'occupied');
        });
      }
    );

    req.on('timeout', () => {
      settle('occupied');
      req.destroy();
    });
    req.on('error', (error: NodeJS.ErrnoException) => {
      settle(error.code === 'ECONNREFUSED' ? 'free' : 'occupied');
    });
  });
}

function pnpmCommand(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function pipeMetroLog(stream: NodeJS.ReadableStream, level: 'info' | 'warn', prefix: string): void {
  let buffer = '';
  stream.on('data', (chunk: Buffer | string) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (level === 'warn') {
        log.warn(prefix, { line });
      } else {
        log.info(prefix, { line });
      }
    }
  });
}

function mapOpenProjectError(error: OpenProjectError): string {
  switch (error.type) {
    case 'path-not-found':
      return `Project path not found: ${error.path}`;
    case 'ssh-disconnected':
      return `SSH connection is disconnected: ${error.connectionId}`;
    case 'error':
      return error.message;
  }
}

function mapCreateTaskError(error: CreateTaskError): string {
  switch (error.type) {
    case 'project-not-found':
      return 'Project was not found.';
    case 'initial-commit-required':
      return `Project needs an initial commit before task creation: ${error.branch}`;
    case 'branch-create-failed':
      return `Could not create branch "${error.branch}".`;
    case 'pr-fetch-failed':
      return `Could not fetch pull request from remote "${error.remote}".`;
    case 'branch-not-found':
      return `Branch was not found: ${error.branch}`;
    case 'worktree-setup-failed':
      return error.message ?? `Could not set up worktree for branch "${error.branch}".`;
    case 'provision-failed':
      return `Task could not be provisioned: ${error.message}`;
    case 'provision-timeout':
      return `Task setup timed out after ${Math.round(error.timeoutMs / 1000)}s.`;
  }
}

function mapCreateTaskWarning(warning: CreateTaskWarning): string {
  switch (warning.type) {
    case 'branch-publish-failed':
      return `Branch "${warning.branch}" was created but could not be published to "${warning.remote}".`;
    case 'task-naming-failed':
      return warning.blocksProvision
        ? `Task naming failed: ${warning.message}`
        : `Task naming failed; using the initial title: ${warning.message}`;
    case 'branch-setup-failed':
      return `Could not prepare branch "${warning.branch}": ${warning.message}`;
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCreateDemandRequest(body: unknown): MobileCreateDemandRequest {
  if (!body || typeof body !== 'object') {
    throw new MobileGatewayError(400, 'invalid_body', 'Request body must be an object.');
  }

  const value = body as Record<string, unknown>;
  const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
  if (!prompt) {
    throw new MobileGatewayError(400, 'missing_prompt', 'Prompt is required.');
  }

  return {
    prompt,
    projectId: typeof value.projectId === 'string' ? value.projectId.trim() || null : null,
    title: typeof value.title === 'string' ? value.title.trim() || undefined : undefined,
    provider: typeof value.provider === 'string' ? value.provider.trim() || undefined : undefined,
  };
}

function normalizeSessionInputRequest(body: unknown): MobileSessionInputRequest {
  if (!body || typeof body !== 'object') {
    throw new MobileGatewayError(400, 'invalid_body', 'Request body must be an object.');
  }

  const value = body as Record<string, unknown>;
  const input = typeof value.input === 'string' ? value.input.trim() : '';
  if (!input) {
    throw new MobileGatewayError(400, 'missing_input', 'Input is required.');
  }
  if (input.length > MOBILE_SESSION_INPUT_MAX_CHARS) {
    throw new MobileGatewayError(
      413,
      'input_too_large',
      `Input must be ${MOBILE_SESSION_INPUT_MAX_CHARS} characters or fewer.`
    );
  }

  return {
    input,
    submit: typeof value.submit === 'boolean' ? value.submit : true,
  };
}

function isRuntimeId(value: string): value is RuntimeId {
  return RUNTIME_IDS.includes(value as RuntimeId);
}

function isTaskActivityRunning(status: MobileTaskActivityStatus): boolean {
  return status === 'working' || status === 'awaiting-input' || status === 'bootstrapping';
}

function resolveTaskActivityStatus(
  task: Task,
  runtimeStatuses: AgentSessionRuntimeStatus[],
  bootstrapStatus = taskManager.getBootstrapStatus(task.id)
): MobileTaskActivityStatus {
  if (bootstrapStatus.status === 'bootstrapping') return 'bootstrapping';
  if (bootstrapStatus.status === 'error') return 'error';
  if (runtimeStatuses.includes('working')) return 'working';
  if (runtimeStatuses.includes('awaiting-input')) return 'awaiting-input';
  if (runtimeStatuses.includes('error')) return 'error';
  if (task.status === 'review' || task.needsReview) return 'review';
  if (task.status === 'done') return 'done';
  if (task.status === 'cancelled') return 'cancelled';
  if (task.status === 'todo') return 'todo';
  if (runtimeStatuses.includes('completed')) return 'completed';
  return 'idle';
}

export class MobileGatewayService {
  private server: http.Server | null = null;
  private metroProcess: ChildProcess | null = null;
  private metroEnsureInFlight: Promise<void> | null = null;
  private token = '';
  private host = '0.0.0.0';
  private port = MOBILE_GATEWAY_DEFAULT_PORT;

  async initialize(): Promise<void> {
    if (!shouldStartGateway()) return;

    this.host = process.env.YODA_MOBILE_GATEWAY_HOST?.trim() || '0.0.0.0';
    this.port = parsePort(process.env.YODA_MOBILE_GATEWAY_PORT);
    this.token = mobileGatewayToken();

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res).catch((e: unknown) => {
        if (e instanceof MobileGatewayError) {
          writeError(res, e);
          return;
        }
        log.warn('MobileGateway: request failed', { error: String(e) });
        writeError(
          res,
          new MobileGatewayError(500, 'internal_error', 'Mobile gateway request failed.')
        );
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.port, this.host, () => {
        const address = this.server!.address();
        if (address && typeof address === 'object') {
          this.port = address.port;
        }
        resolve();
      });
      this.server!.on('error', reject);
    });

    log.info('MobileGateway: started', {
      host: this.host,
      port: this.port,
      urls: lanUrls(this.port),
      token: process.env.YODA_MOBILE_GATEWAY_TOKEN ? '<env>' : this.token,
    });

    // Reap any Metro orphaned by a crashed previous run at startup, even though
    // Metro itself now only starts lazily via getConnectionInfo().
    killStaleMetroFromPidFile();
  }

  dispose(): void {
    this.disposeMetroProcess();
    if (!this.server) return;
    this.server.close();
    this.server = null;
  }

  // Metro costs ~450MB RSS, so it is started lazily: only when the user opens
  // the mobile connection view (getConnectionInfo), not on gateway startup.
  private ensureLocalMetroLazy(): void {
    if (!this.server) return;
    if (this.metroEnsureInFlight) return;

    const primaryUrl = lanUrls(this.port)[0] ?? `http://localhost:${this.port}`;
    this.metroEnsureInFlight = this.ensureLocalMetro(primaryUrl)
      .catch((error: unknown) => {
        log.warn('MobileGateway: failed to ensure Expo Metro is running', {
          error: String(error),
        });
      })
      .finally(() => {
        this.metroEnsureInFlight = null;
      });
  }

  private async ensureLocalMetro(primaryUrl: string): Promise<void> {
    if (!shouldAutoStartLocalMetro()) return;
    if (this.metroProcess) return;

    const metroHost = metroHostFromGatewayUrl(primaryUrl);
    if (!metroHost) return;

    const status = await getMetroStatus();
    if (status === 'running') {
      log.info('MobileGateway: Expo Metro already running', {
        url: `exp://${metroHost}:${MOBILE_METRO_DEFAULT_PORT}`,
      });
      return;
    }
    if (status === 'occupied') {
      log.warn('MobileGateway: cannot auto-start Expo Metro because port is occupied', {
        port: MOBILE_METRO_DEFAULT_PORT,
      });
      return;
    }

    const child = spawn(
      pnpmCommand(),
      ['--filter', '@yoda/mobile', 'start', '--', '--host', 'lan'],
      {
        cwd: process.cwd(),
        detached: process.platform !== 'win32',
        env: {
          ...process.env,
          EXPO_NO_TELEMETRY: '1',
          REACT_NATIVE_PACKAGER_HOSTNAME: metroHost,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    this.metroProcess = child;
    if (child.pid) writeMetroPidFile(child.pid);
    pipeMetroLog(child.stdout, 'info', 'MobileGateway: Expo Metro');
    pipeMetroLog(child.stderr, 'warn', 'MobileGateway: Expo Metro');

    child.on('error', (error) => {
      if (this.metroProcess === child) this.metroProcess = null;
      log.warn('MobileGateway: Expo Metro failed to start', { error: String(error) });
    });
    child.on('exit', (code, signal) => {
      if (this.metroProcess === child) this.metroProcess = null;
      removeMetroPidFile();
      log.info('MobileGateway: Expo Metro exited', { code, signal });
    });

    log.info('MobileGateway: starting Expo Metro', {
      url: `exp://${metroHost}:${MOBILE_METRO_DEFAULT_PORT}`,
    });
  }

  private disposeMetroProcess(): void {
    const child = this.metroProcess;
    if (!child) return;
    this.metroProcess = null;

    try {
      if (process.platform !== 'win32' && child.pid) {
        process.kill(-child.pid, 'SIGTERM');
      } else {
        child.kill('SIGTERM');
      }
    } catch (error) {
      log.warn('MobileGateway: failed to stop Expo Metro', { error: String(error) });
    }
  }

  getConnectionInfo(): MobileGatewayConnectionInfo {
    this.ensureLocalMetroLazy();
    const urls = lanUrls(this.port);
    const primaryUrl = urls[0] ?? `http://localhost:${this.port}`;
    return {
      enabled: shouldStartGateway(),
      running: Boolean(this.server),
      mode: isDevelopment() ? 'development' : 'production',
      host: this.host,
      port: this.port,
      token: this.token || null,
      urls,
      localExpoUrl: this.token ? localExpoUrl(primaryUrl, this.token) : null,
      installUrl: mobileInstallUrl(),
      pairingUrl:
        this.server && this.token
          ? createMobilePairingUrl({ baseUrl: primaryUrl, token: this.token })
          : null,
    };
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method === 'OPTIONS') {
      writeJson(res, 204, {});
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/health') {
      writeJson(res, 200, {
        ok: true,
        service: 'yoda-mobile-gateway',
        tokenRequired: true,
      });
      return;
    }

    if (!this.isAuthorized(req)) {
      throw new MobileGatewayError(401, 'unauthorized', 'Valid mobile gateway token is required.');
    }

    if (req.method === 'GET' && url.pathname === '/v1/snapshot') {
      writeJson(res, 200, await this.getSnapshot());
      return;
    }

    const segments = pathSegments(url.pathname);
    const isTaskSessionsRoute =
      segments[0] === 'v1' &&
      segments[1] === 'projects' &&
      Boolean(segments[2]) &&
      segments[3] === 'tasks' &&
      Boolean(segments[4]) &&
      segments[5] === 'sessions';

    if (req.method === 'GET' && isTaskSessionsRoute && segments.length === 6) {
      writeJson(res, 200, await this.getTaskSessions(segments[2]!, segments[4]!));
      return;
    }

    if (req.method === 'GET' && isTaskSessionsRoute && segments.length === 7 && segments[6]) {
      writeJson(res, 200, await this.getSessionDetail(segments[2]!, segments[4]!, segments[6]));
      return;
    }

    if (
      req.method === 'POST' &&
      isTaskSessionsRoute &&
      segments.length === 8 &&
      segments[6] &&
      segments[7] === 'input'
    ) {
      const body = normalizeSessionInputRequest(await readJsonBody(req));
      writeJson(
        res,
        200,
        await this.sendSessionInput(segments[2]!, segments[4]!, segments[6], body)
      );
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/demands') {
      const body = normalizeCreateDemandRequest(await readJsonBody(req));
      writeJson(res, 201, await this.createDemand(body));
      return;
    }

    throw new MobileGatewayError(404, 'not_found', 'Mobile gateway endpoint was not found.');
  }

  private isAuthorized(req: http.IncomingMessage): boolean {
    const authHeader = req.headers.authorization;
    const bearer =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : '';
    const headerToken = req.headers['x-yoda-mobile-token'];
    return bearer === this.token || headerToken === this.token;
  }

  private async getSnapshot(): Promise<MobileDashboardSnapshot> {
    const [projects, tasks] = await Promise.all([getProjects(), getTasks()]);
    const mappedProjects = projects.map((project) => this.mapProject(project));
    const activeTasks = tasks.filter((task) => !task.archivedAt);
    const activityStatuses = await this.getTaskActivityStatuses(activeTasks);
    const mappedTasks = activeTasks.map((task) =>
      this.mapTask(task, activityStatuses.get(task.id) ?? 'idle')
    );

    return {
      generatedAt: new Date().toISOString(),
      projects: mappedProjects,
      tasks: mappedTasks,
      metrics: {
        projectCount: mappedProjects.filter((project) => !project.isInternal).length,
        openProjectCount: mappedProjects.filter((project) => project.isOpen && !project.isInternal)
          .length,
        activeTaskCount: mappedTasks.length,
        inProgressTaskCount: mappedTasks.filter((task) =>
          isTaskActivityRunning(task.activityStatus)
        ).length,
        reviewTaskCount: mappedTasks.filter((task) => task.activityStatus === 'review').length,
      },
    };
  }

  private mapProject(project: Project): MobileProjectSummary {
    return {
      id: project.id,
      name: project.name,
      displayName: project.isInternal ? 'Drafts' : projectDisplayName(project),
      type: project.type,
      path: project.path,
      isInternal: project.isInternal,
      isOpen: Boolean(projectManager.getProject(project.id)),
      updatedAt: project.updatedAt,
    };
  }

  private mapTask(task: Task, activityStatus: MobileTaskActivityStatus): MobileTaskSummary {
    return {
      id: task.id,
      projectId: task.projectId,
      name: task.name,
      status: task.status,
      activityStatus,
      bootstrapStatus: taskManager.getBootstrapStatus(task.id),
      taskBranch: task.taskBranch,
      updatedAt: task.updatedAt,
      lastInteractedAt: task.lastInteractedAt,
      needsReview: task.needsReview,
      isPinned: task.isPinned,
      runtimeCounts: task.conversations,
      conversationCount: Object.values(task.conversations).reduce((sum, count) => sum + count, 0),
    };
  }

  private async getTaskActivityStatuses(
    tasks: Task[]
  ): Promise<Map<string, MobileTaskActivityStatus>> {
    const entries = await Promise.all(
      tasks.map(async (task): Promise<[string, MobileTaskActivityStatus]> => {
        const bootstrapStatus = taskManager.getBootstrapStatus(task.id);
        const conversationCount = Object.values(task.conversations).reduce(
          (sum, count) => sum + count,
          0
        );
        if (conversationCount === 0) {
          return [task.id, resolveTaskActivityStatus(task, [], bootstrapStatus)];
        }

        const conversations = await getConversationsForTask(task.projectId, task.id).catch(
          (error: unknown) => {
            log.warn('MobileGateway: failed to load task conversations for activity status', {
              taskId: task.id,
              error: String(error),
            });
            return [];
          }
        );
        const runtimeByConversation = await getConversationRuntimeStatuses(
          task.projectId,
          task.id,
          conversations.map((conversation) => conversation.id)
        ).catch((error: unknown) => {
          log.warn('MobileGateway: failed to load task runtime status', {
            taskId: task.id,
            error: String(error),
          });
          return {};
        });

        return [
          task.id,
          resolveTaskActivityStatus(task, Object.values(runtimeByConversation), bootstrapStatus),
        ];
      })
    );
    return new Map(entries);
  }

  private async getTaskSessions(
    projectId: string,
    taskId: string
  ): Promise<MobileTaskSessionsResponse> {
    const data = await this.loadTaskSessionData(projectId, taskId);
    return {
      projectId,
      taskId,
      sessions: data.sessions,
    };
  }

  private async getSessionDetail(
    projectId: string,
    taskId: string,
    conversationId: string
  ): Promise<MobileSessionDetail> {
    const data = await this.loadTaskSessionData(projectId, taskId);
    const conversation = data.conversations.find((item) => item.id === conversationId);
    const session = data.sessions.find((item) => item.id === conversationId);

    if (!conversation || !session) {
      throw new MobileGatewayError(404, 'session_not_found', 'Mobile session was not found.');
    }

    const ptySessionId = makePtySessionId(projectId, taskId, conversationId);
    const [output, transcript] = await Promise.all([
      this.readConversationOutput(conversation, data.cwd, ptySessionId),
      this.readConversationTranscript(conversation, data.cwd, session.sessionId),
    ]);
    const tailed = tailSessionContent(output.content);

    return {
      generatedAt: new Date().toISOString(),
      session,
      content: tailed.content,
      contentLength: tailed.contentLength,
      truncated: tailed.truncated,
      source: output.source,
      transcript,
    };
  }

  private async sendSessionInput(
    projectId: string,
    taskId: string,
    conversationId: string,
    params: MobileSessionInputRequest
  ): Promise<MobileSessionInputResponse> {
    const data = await this.loadTaskSessionData(projectId, taskId);
    const conversation = data.conversations.find((item) => item.id === conversationId);

    if (!conversation) {
      throw new MobileGatewayError(404, 'session_not_found', 'Mobile session was not found.');
    }

    const payload = buildPromptInjectionPayload(params.input);
    if (!payload) {
      throw new MobileGatewayError(400, 'missing_input', 'Input is required.');
    }

    if (!(await this.writeConversationInput(projectId, taskId, conversationId, payload))) {
      throw new MobileGatewayError(
        409,
        'session_not_live',
        'This session is not currently accepting input.'
      );
    }
    if (params.submit !== false) {
      await sleep(getAgentCommandSubmitDelayMs(conversation.runtimeId));
      if (
        !(await this.writeConversationInput(
          projectId,
          taskId,
          conversationId,
          getAgentCommandSubmitInput(conversation.runtimeId)
        ))
      ) {
        throw new MobileGatewayError(
          409,
          'session_not_live',
          'This session stopped before the input could be submitted.'
        );
      }
    }

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
    };
  }

  private async writeConversationInput(
    projectId: string,
    taskId: string,
    conversationId: string,
    data: string
  ): Promise<boolean> {
    const ptySessionId = makePtySessionId(projectId, taskId, conversationId);
    const pty = ptySessionRegistry.get(ptySessionId);
    if (pty) {
      pty.write(data);
      return true;
    }

    return (
      (await taskManager.getTask(taskId)?.conversations.sendInput(conversationId, data)) ?? false
    );
  }

  private async loadTaskSessionData(projectId: string, taskId: string): Promise<TaskSessionData> {
    const project = await this.requireProject(projectId);
    const cwd = this.resolveTaskCwd(project, taskId);
    const conversations = (await getConversationsForTask(projectId, taskId)).sort(
      compareConversations
    );
    const statuses = await getConversationRuntimeStatuses(
      projectId,
      taskId,
      conversations.map((conversation) => conversation.id)
    );
    const sessions = await Promise.all(
      conversations.map((conversation) =>
        this.mapSession(conversation, statuses[conversation.id] ?? 'idle', cwd)
      )
    );

    return { cwd, conversations, sessions };
  }

  private async requireProject(projectId: string): Promise<Project> {
    const project = await getProjectById(projectId);
    if (!project) {
      throw new MobileGatewayError(404, 'project_not_found', 'Project was not found.');
    }
    return project;
  }

  private resolveTaskCwd(project: Project, taskId: string): string {
    const workspaceId = taskManager.getWorkspaceId(taskId);
    return (workspaceId ? workspaceRegistry.get(workspaceId)?.path : null) ?? project.path;
  }

  private async mapSession(
    conversation: Conversation,
    runtimeStatus: AgentSessionRuntimeStatus,
    cwd: string
  ): Promise<MobileSessionSummary> {
    const ptySessionId = makePtySessionId(
      conversation.projectId,
      conversation.taskId,
      conversation.id
    );
    const sessionInfo = await getConversationSessionInfo(
      conversation.projectId,
      conversation.taskId,
      conversation.id,
      cwd
    ).catch((error: unknown) => {
      log.warn('MobileGateway: failed to resolve session info', {
        conversationId: conversation.id,
        error: String(error),
      });
      return null;
    });
    const acceptsInput = Boolean(sessionInfo?.running || ptySessionRegistry.get(ptySessionId));

    return {
      id: conversation.id,
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      title: conversation.title,
      runtimeId: conversation.runtimeId,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      lastInteractedAt: conversation.lastInteractedAt,
      isInitialConversation: conversation.isInitialConversation,
      runtimeStatus,
      running: Boolean(sessionInfo?.running || acceptsInput),
      acceptsInput,
      tmuxEnabled: sessionInfo?.tmuxEnabled ?? false,
      sessionId: sessionInfo?.sessionId ?? conversation.id,
      sessionTitle: sessionInfo?.sessionTitle,
    };
  }

  private async readConversationOutput(
    conversation: Conversation,
    cwd: string,
    ptySessionId: string
  ): Promise<{ content: string; source: MobileSessionContentSource }> {
    const liveBuffer = ptySessionRegistry.snapshot(ptySessionId);
    if (liveBuffer || ptySessionRegistry.get(ptySessionId)) {
      return { content: liveBuffer, source: 'live' };
    }

    if (conversation.runtimeId === 'codex') {
      const history = await loadCodexRolloutTerminalHistoryForConversation({
        conversation,
        cwd,
      }).catch((error: unknown) => {
        log.warn('MobileGateway: failed to load session history', {
          conversationId: conversation.id,
          error: String(error),
        });
        return null;
      });
      if (history) return { content: history, source: 'history' };
    }

    return { content: '', source: 'empty' };
  }

  private async readConversationTranscript(
    conversation: Conversation,
    cwd: string,
    sessionId: string
  ): Promise<MobileSessionTranscriptBlock[]> {
    if (conversation.runtimeId === 'claude') {
      const transcript = await loadClaudeTranscript({
        cwd,
        sessionId,
      }).catch((error: unknown) => {
        log.warn('MobileGateway: failed to load Claude session transcript', {
          conversationId: conversation.id,
          error: String(error),
        });
        return null;
      });
      return transcript ?? [];
    }

    if (conversation.runtimeId !== 'codex') return [];

    const transcript = await loadCodexRolloutTranscriptForConversation({
      conversation,
      cwd,
    }).catch((error: unknown) => {
      log.warn('MobileGateway: failed to load session transcript', {
        conversationId: conversation.id,
        error: String(error),
      });
      return null;
    });

    return transcript ?? [];
  }

  private async createDemand(
    params: MobileCreateDemandRequest
  ): Promise<MobileCreateDemandResponse> {
    const projectId = params.projectId || INTERNAL_PROJECT_ID;
    const project = await this.ensureProjectOpen(projectId);
    const provider = await this.resolveProvider(params.provider);
    const taskId = randomUUID();
    const conversationId = randomUUID();
    const existingTaskNames = (await getTasks(projectId)).map((task) => task.name);
    const generatedName = generateTaskName({ title: params.title || params.prompt });
    const taskName = ensureUniqueTaskSlug(generatedName, existingTaskNames);
    const sourceBranch = await this.resolveSourceBranch(project, projectId);

    const result = await createTask({
      id: taskId,
      projectId,
      name: taskName,
      sourceBranch,
      strategy: { kind: 'no-worktree' },
      initialConversation: {
        id: conversationId,
        projectId,
        taskId,
        runtime: provider,
        title: taskNameFromPrompt(params.prompt) || 'Mobile request',
        initialPrompt: params.prompt,
      },
    });

    if (!result.success) {
      throw new MobileGatewayError(422, 'create_task_failed', mapCreateTaskError(result.error));
    }

    return {
      task: this.mapTask(result.data.task, resolveTaskActivityStatus(result.data.task, [])),
      warning: result.data.warning ? mapCreateTaskWarning(result.data.warning) : undefined,
    };
  }

  private async ensureProjectOpen(projectId: string): Promise<Project> {
    const project = await getProjectById(projectId);
    if (!project) {
      throw new MobileGatewayError(404, 'project_not_found', 'Project was not found.');
    }
    if (projectManager.getProject(projectId)) return project;

    const result = await openProject(projectId);
    if (!result.success) {
      throw new MobileGatewayError(424, 'project_open_failed', mapOpenProjectError(result.error));
    }
    return project;
  }

  private async resolveProvider(provider: string | undefined): Promise<RuntimeId> {
    if (provider) {
      if (isRuntimeId(provider)) return provider;
      throw new MobileGatewayError(400, 'invalid_provider', `Unsupported provider: ${provider}`);
    }
    return appSettingsService.get('defaultRuntime');
  }

  private async resolveSourceBranch(project: Project, projectId: string) {
    const provider = projectManager.getProject(projectId);
    const repoInfo = await provider?.repository.getRepositoryInfo().catch(() => null);
    return {
      type: 'local' as const,
      branch: repoInfo?.currentBranch || project.baseRef || 'main',
    };
  }
}

export const mobileGatewayService = new MobileGatewayService();
