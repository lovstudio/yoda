import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';
import { app } from 'electron';
import { resolveAgentPermissionMode, type Agent } from '@shared/agents';
import { BUILTIN_AGENT_KEYS } from '@shared/builtin-agents';
import type { Conversation } from '@shared/conversations';
import type { AgentSessionRuntimeStatus } from '@shared/events/agentEvents';
import {
  canContinueMobileSession,
  createExpoGoPairingUrl,
  createMobilePairingUrl,
  getMobileProjectActivityById,
  MOBILE_APP_DEFAULT_INSTALL_URL,
  MOBILE_GATEWAY_DEFAULT_DEV_TOKEN,
  MOBILE_GATEWAY_DEFAULT_PORT,
  MOBILE_SESSION_CONTENT_MAX_CHARS,
  MOBILE_SESSION_INPUT_MAX_CHARS,
  MOBILE_SESSION_TRANSCRIPT_MAX_CHARS,
  type MobileAgentSummary,
  type MobileApiError,
  type MobileConfigurationSnapshot,
  type MobileCreateDemandRequest,
  type MobileCreateDemandResponse,
  type MobileDashboardSnapshot,
  type MobileGatewayConnectionInfo,
  type MobileInputAttachmentChunkRequest,
  type MobileInputAttachmentCompleteResponse,
  type MobileInputAttachmentCreateRequest,
  type MobileInputAttachmentCreateResponse,
  type MobileInputAttachmentDiscardResponse,
  type MobileProfileSnapshot,
  type MobileProjectSummary,
  type MobileRunMode,
  type MobileSessionAgent,
  type MobileSessionContentSource,
  type MobileSessionDetail,
  type MobileSessionInputRequest,
  type MobileSessionInputResponse,
  type MobileSessionRuntimeConfigurationResponse,
  type MobileSessionRuntimeConfigurationUpdate,
  type MobileSessionSummary,
  type MobileSessionTranscriptBlock,
  type MobileSkillsResponse,
  type MobileTaskActionRequest,
  type MobileTaskActionResponse,
  type MobileTaskActivityStatus,
  type MobileTaskSessionsResponse,
  type MobileTaskStrategyKind,
  type MobileTaskSummary,
} from '@shared/mobile-api';
import {
  MOBILE_SESSION_EVENT_VERSION,
  type MobileSessionInvalidationReason,
} from '@shared/mobile-session-events';
import { resolveMobileSessionInteraction } from '@shared/mobile-session-interaction';
import {
  INTERNAL_PROJECT_ID,
  projectDisplayName,
  type OpenProjectError,
  type Project,
} from '@shared/projects';
import { withSystemPrompt } from '@shared/prompt-format';
import { makePtySessionId } from '@shared/ptySessionId';
import {
  getRuntime,
  getRuntimePermissionModes,
  resolveRuntimePermissionModeId,
  RUNTIME_IDS,
  type RuntimeId,
} from '@shared/runtime-registry';
import type { SettingsSyncStatus } from '@shared/settings-sync';
import { normalizeSkillSelection } from '@shared/skills/selection';
import { ensureUniqueTaskSlug, taskNameFromPrompt } from '@shared/task-name';
import type { CreateTaskError, CreateTaskWarning, Task } from '@shared/tasks';
import {
  yodaAccountService,
  type SessionState,
} from '@main/core/account/services/yoda-account-service';
import { yodaCommerceService } from '@main/core/account/services/yoda-commerce-service';
import { agentsConfigService } from '@main/core/agents-config/agents-config-service';
import { agentSessionRuntimeStore } from '@main/core/conversations/agent-session-runtime';
import { loadClaudeTranscript } from '@main/core/conversations/claude-transcript';
import {
  loadCodexRolloutShareImagesTailForConversation,
  loadCodexRolloutTerminalHistoryTailForConversation,
  loadCodexRolloutTranscriptTailForConversation,
  type CodexRolloutShareImageGroup,
} from '@main/core/conversations/codex-rollout-terminal-history';
import { getActiveRuntimeStatuses } from '@main/core/conversations/getActiveRuntimeStatuses';
import { getClaudeSessionMetadata } from '@main/core/conversations/getClaudeSessionMetadata';
import { getCodexSessionContext } from '@main/core/conversations/getCodexSessionContext';
import { getConversationRuntimeStatuses } from '@main/core/conversations/getConversationRuntimeStatuses';
import { getConversationSessionInfo } from '@main/core/conversations/getConversationSessionInfo';
import { getConversationsForTask } from '@main/core/conversations/getConversationsForTask';
import { injectPromptUsingWriter } from '@main/core/conversations/inject-prompt';
import { injectConversationPrompt } from '@main/core/conversations/injectConversationPrompt';
import { restartConversation } from '@main/core/conversations/restartConversation';
import { subscribeConversationTranscriptChanges } from '@main/core/conversations/transcript-feed';
import { getProjectById, getProjects } from '@main/core/projects/operations/getProjects';
import { openProject } from '@main/core/projects/operations/openProject';
import { projectManager } from '@main/core/projects/project-manager';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { settingsSyncService } from '@main/core/settings-sync/service';
import { appSettingsService } from '@main/core/settings/settings-service';
import { skillsService } from '@main/core/skills/SkillsService';
import { getUsageOverview } from '@main/core/stats/getUsageOverview';
import { generateTaskName } from '@main/core/tasks/name-generation/generateTaskName';
import { archiveTask } from '@main/core/tasks/operations/archiveTask';
import { createTask } from '@main/core/tasks/operations/createTask';
import {
  getAllActiveTasks,
  getAllTaskActivityTimestamps,
  getTasks,
} from '@main/core/tasks/operations/getTasks';
import { setTaskFavorite } from '@main/core/tasks/operations/setTaskFavorite';
import { setTaskLongTerm } from '@main/core/tasks/operations/setTaskLongTerm';
import { setTaskNeedsReview } from '@main/core/tasks/operations/setTaskNeedsReview';
import { setTaskPinned } from '@main/core/tasks/operations/setTaskPinned';
import { taskManager } from '@main/core/tasks/task-manager';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { log } from '@main/lib/logger';
import { MobileDashboardSnapshotCache } from './mobile-dashboard-snapshot-cache';
import {
  MobileInputAttachmentError,
  MobileInputAttachmentStore,
} from './mobile-input-attachment-store';
import { mapMobilePermissionMode } from './mobile-permission-modes';
import {
  ensureMobileConversationInputSession,
  resolveMobileSessionAvailability,
} from './mobile-session-continuation';
import {
  MOBILE_SESSION_RECONNECT_RETRY_MS,
  MobileSessionEventStream,
} from './mobile-session-event-stream';
import { submitMobileSessionInput } from './mobile-session-input-delivery';
import {
  MobileSessionInputRequestCache,
  MobileSessionInputRequestConflictError,
} from './mobile-session-input-requests';
import { mobileSkillSummaries } from './mobile-skills';
import {
  resolveMobileTaskActivityStatuses,
  resolveTaskActivityStatus,
} from './mobile-task-activity';
import { mobileGatewayNetworkUrls } from './network-addresses';

const MAX_BODY_BYTES = 128 * 1024;
const MOBILE_METRO_DEFAULT_PORT = 8081;
const METRO_STATUS_TIMEOUT_MS = 1000;
const METRO_STOP_TIMEOUT_MS = 3000;

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
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, Last-Event-ID, X-Yoda-Mobile-Token',
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

function tailSessionTranscript(blocks: MobileSessionTranscriptBlock[]): {
  transcript: MobileSessionTranscriptBlock[];
  truncated: boolean;
} {
  let remaining = MOBILE_SESSION_TRANSCRIPT_MAX_CHARS;
  const transcript: MobileSessionTranscriptBlock[] = [];

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (!block) continue;
    if (block.content.length <= remaining) {
      transcript.unshift(block);
      remaining -= block.content.length;
      continue;
    }

    if (remaining > 0) {
      const marker = '[Earlier activity truncated]\n';
      const available = Math.max(0, remaining - marker.length);
      transcript.unshift({
        ...block,
        content:
          remaining <= marker.length
            ? marker.slice(0, remaining)
            : `${marker}${block.content.slice(-available)}`,
      });
    }
    return { transcript, truncated: true };
  }

  return { transcript, truncated: false };
}

function compareConversations(a: Conversation, b: Conversation): number {
  if (a.isInitialConversation === true && b.isInitialConversation !== true) return -1;
  if (a.isInitialConversation !== true && b.isInitialConversation === true) return 1;
  const aTime = Date.parse(a.lastInteractedAt ?? a.updatedAt ?? a.createdAt ?? '');
  const bTime = Date.parse(b.lastInteractedAt ?? b.updatedAt ?? b.createdAt ?? '');
  return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
}

function lanUrls(port: number): string[] {
  return mobileGatewayNetworkUrls(networkInterfaces(), port).map(({ url }) => url);
}

function mobileInstallUrl(): string {
  return process.env.YODA_MOBILE_INSTALL_URL?.trim() || MOBILE_APP_DEFAULT_INSTALL_URL;
}

function gatewayTokenFilePath(): string {
  return path.join(app.getPath('userData'), 'mobile-gateway-token');
}

function mobileGatewayToken(): string {
  const envToken = process.env.YODA_MOBILE_GATEWAY_TOKEN?.trim();
  if (envToken) return envToken;
  if (isDevelopment()) return MOBILE_GATEWAY_DEFAULT_DEV_TOKEN;

  // Persist the generated token so desktop restarts don't invalidate paired phones.
  try {
    const existing = fs.readFileSync(gatewayTokenFilePath(), 'utf8').trim();
    if (existing) return existing;
  } catch {
    // first run: no token file yet
  }
  const token = randomUUID();
  try {
    fs.writeFileSync(gatewayTokenFilePath(), token, { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    log.warn('MobileGateway: failed to persist gateway token', { error: String(error) });
  }
  return token;
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

function normalizeNullableConfigText(
  value: unknown,
  field: string,
  maxLength = 200
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new MobileGatewayError(400, 'invalid_configuration', `${field} must be a string.`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new MobileGatewayError(
      413,
      'configuration_too_large',
      `${field} must be ${maxLength} characters or fewer.`
    );
  }
  return normalized || null;
}

function normalizeMobileRunMode(value: unknown): MobileRunMode {
  if (value === undefined || value === 'normal') return 'normal';
  if (value === 'brainstorm') return 'brainstorm';
  throw new MobileGatewayError(400, 'invalid_configuration', 'Unsupported mobile run mode.');
}

function normalizeMobileStrategyKind(value: unknown): MobileTaskStrategyKind {
  if (value === undefined || value === 'no-worktree') return 'no-worktree';
  if (value === 'new-branch') return 'new-branch';
  throw new MobileGatewayError(400, 'invalid_configuration', 'Unsupported mobile project mode.');
}

function normalizeCreateDemandRequest(body: unknown): MobileCreateDemandRequest {
  if (!body || typeof body !== 'object') {
    throw new MobileGatewayError(400, 'invalid_body', 'Request body must be an object.');
  }

  const value = body as Record<string, unknown>;
  const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
  const attachmentIds = normalizeAttachmentIds(value.attachmentIds);
  if (!prompt && attachmentIds.length === 0) {
    throw new MobileGatewayError(400, 'missing_prompt', 'Prompt is required.');
  }
  if (prompt.length > MOBILE_SESSION_INPUT_MAX_CHARS) {
    throw new MobileGatewayError(
      413,
      'prompt_too_large',
      `Prompt must be ${MOBILE_SESSION_INPUT_MAX_CHARS} characters or fewer.`
    );
  }

  return {
    prompt,
    projectId: typeof value.projectId === 'string' ? value.projectId.trim() || null : null,
    parentTaskId:
      typeof value.parentTaskId === 'string' ? value.parentTaskId.trim() || undefined : undefined,
    title: typeof value.title === 'string' ? value.title.trim() || undefined : undefined,
    provider: typeof value.provider === 'string' ? value.provider.trim() || undefined : undefined,
    attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
    agentId:
      value.agentId === null
        ? null
        : typeof value.agentId === 'string'
          ? value.agentId.trim() || null
          : value.agentId === undefined
            ? undefined
            : (() => {
                throw new MobileGatewayError(400, 'invalid_configuration', 'Agent id is invalid.');
              })(),
    runMode: normalizeMobileRunMode(value.runMode),
    strategyKind: normalizeMobileStrategyKind(value.strategyKind),
    model: normalizeNullableConfigText(value.model, 'model'),
    reasoningEffort: normalizeNullableConfigText(value.reasoningEffort, 'reasoningEffort'),
    permissionMode:
      value.permissionMode === undefined
        ? undefined
        : typeof value.permissionMode === 'string' && value.permissionMode.trim()
          ? value.permissionMode.trim()
          : (() => {
              throw new MobileGatewayError(
                400,
                'invalid_configuration',
                'permissionMode is invalid.'
              );
            })(),
  };
}

function normalizeSessionRuntimeConfigurationRequest(
  body: unknown
): MobileSessionRuntimeConfigurationUpdate {
  if (!body || typeof body !== 'object') {
    throw new MobileGatewayError(400, 'invalid_body', 'Request body must be an object.');
  }
  const value = body as Record<string, unknown>;
  const update: MobileSessionRuntimeConfigurationUpdate = {};
  if ('model' in value) update.model = normalizeNullableConfigText(value.model, 'model');
  if ('reasoningEffort' in value) {
    update.reasoningEffort = normalizeNullableConfigText(value.reasoningEffort, 'reasoningEffort');
  }
  if ('permissionMode' in value) {
    if (typeof value.permissionMode !== 'string' || !value.permissionMode.trim()) {
      throw new MobileGatewayError(400, 'invalid_configuration', 'permissionMode is invalid.');
    }
    update.permissionMode = value.permissionMode.trim();
  }
  if (Object.keys(update).length === 0) {
    throw new MobileGatewayError(400, 'invalid_configuration', 'No runtime setting was provided.');
  }
  return update;
}

function normalizeSessionInputRequest(body: unknown): MobileSessionInputRequest {
  if (!body || typeof body !== 'object') {
    throw new MobileGatewayError(400, 'invalid_body', 'Request body must be an object.');
  }

  const value = body as Record<string, unknown>;
  const input = typeof value.input === 'string' ? value.input.trim() : '';
  const attachmentIds = normalizeAttachmentIds(value.attachmentIds);
  if (!input && attachmentIds.length === 0) {
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
    attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
    clientRequestId: normalizeMobileClientRequestId(value.clientRequestId),
  };
}

function normalizeMobileTaskActionRequest(body: unknown): MobileTaskActionRequest {
  if (!body || typeof body !== 'object') {
    throw new MobileGatewayError(400, 'invalid_body', 'Request body must be an object.');
  }

  const value = body as Record<string, unknown>;
  if (value.action === 'archive') return { action: 'archive' };

  if (
    value.action !== 'set-pinned' &&
    value.action !== 'set-favorite' &&
    value.action !== 'set-long-term' &&
    value.action !== 'set-needs-review'
  ) {
    throw new MobileGatewayError(400, 'invalid_task_action', 'Task action is invalid.');
  }
  if (typeof value.value !== 'boolean') {
    throw new MobileGatewayError(400, 'invalid_task_action', 'Task action value is invalid.');
  }

  return { action: value.action, value: value.value };
}

function normalizeMobileClientRequestId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    value.length < 16 ||
    value.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(value)
  ) {
    throw new MobileGatewayError(400, 'invalid_request_id', 'Mobile request id is invalid.');
  }
  return value;
}

function normalizeAttachmentIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new MobileGatewayError(400, 'invalid_attachments', 'Attachment ids must be an array.');
  }
  return value.map((attachmentId) => {
    if (
      typeof attachmentId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        attachmentId
      )
    ) {
      throw new MobileGatewayError(400, 'invalid_attachment_id', 'Attachment id is invalid.');
    }
    return attachmentId;
  });
}

function promptWithImageMarkers(prompt: string, imageCount: number): string {
  const markers = Array.from({ length: imageCount }, (_, index) => `{{yoda-image:${index}}}`);
  return [prompt.trim(), ...markers].filter(Boolean).join('\n\n');
}

function isRuntimeId(value: string): value is RuntimeId {
  return RUNTIME_IDS.includes(value as RuntimeId);
}

const MOBILE_HIDDEN_AGENT_SLUGS = new Set([
  'builtin:prompt-rewrite',
  'builtin:naming',
  'builtin:summary',
]);

function isMobileSelectableAgent(agent: Agent): boolean {
  return !MOBILE_HIDDEN_AGENT_SLUGS.has(agent.slug);
}

function compactMobileAgentIcon(icon: string | undefined): string | undefined {
  const normalized = icon?.trim();
  if (!normalized || normalized.startsWith('data:') || normalized.length > 32) return undefined;
  return normalized;
}

function mapMobileAgent(agent: Agent, fallbackRuntime: RuntimeId): MobileAgentSummary {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description || undefined,
    icon: compactMobileAgentIcon(agent.icon),
    preferredRuntime: agent.preferredRuntime ?? fallbackRuntime,
    model: agent.model,
    reasoningEffort: agent.reasoningEffort,
    accessMode: agent.accessMode,
  };
}

function mapSessionAgent(conversation: Conversation, runtimeName: string): MobileSessionAgent {
  return {
    id: conversation.agent?.id ?? null,
    name: conversation.agent?.name ?? runtimeName,
    icon: compactMobileAgentIcon(conversation.agent?.icon),
  };
}

function isTaskActivityRunning(status: MobileTaskActivityStatus): boolean {
  return status === 'working' || status === 'awaiting-input' || status === 'bootstrapping';
}

export class MobileGatewayService {
  private server: http.Server | null = null;
  private attachmentStore: MobileInputAttachmentStore | null = null;
  private readonly sessionEventStreams = new Set<MobileSessionEventStream>();
  private readonly sessionInputRequests =
    new MobileSessionInputRequestCache<MobileSessionInputResponse>();
  private readonly dashboardSnapshotCache =
    new MobileDashboardSnapshotCache<MobileDashboardSnapshot>();
  private readonly sessionEventEpoch = randomUUID();
  private sessionEventSequence = 0;
  private lifecycleGeneration = 0;
  private metroProcess: ChildProcess | null = null;
  private metroHost: string | null = null;
  private metroEnsureInFlight: Promise<void> | null = null;
  private token = '';
  private host = '0.0.0.0';
  private port = MOBILE_GATEWAY_DEFAULT_PORT;

  async initialize(): Promise<void> {
    this.lifecycleGeneration += 1;
    this.dashboardSnapshotCache.clear();
    if (!shouldStartGateway()) return;

    this.host = process.env.YODA_MOBILE_GATEWAY_HOST?.trim() || '0.0.0.0';
    this.port = parsePort(process.env.YODA_MOBILE_GATEWAY_PORT);
    this.token = mobileGatewayToken();
    this.attachmentStore = new MobileInputAttachmentStore(
      path.join(app.getPath('userData'), 'mobile-input-attachments')
    );
    await this.attachmentStore.initialize();

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res).catch((e: unknown) => {
        if (e instanceof MobileInputAttachmentError) {
          writeError(res, new MobileGatewayError(e.status, e.code, e.message));
          return;
        }
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
      token: '<redacted>',
    });

    // Reap any Metro orphaned by a crashed previous run at startup, even though
    // Metro itself now only starts lazily via getConnectionInfo().
    killStaleMetroFromPidFile();
  }

  dispose(): void {
    this.lifecycleGeneration += 1;
    this.dashboardSnapshotCache.clear();
    this.disposeMetroProcess();
    for (const stream of [...this.sessionEventStreams]) stream.close();
    this.sessionInputRequests.clear();
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

    const metroHost = metroHostFromGatewayUrl(primaryUrl);
    if (!metroHost) return;

    if (this.metroProcess) {
      if (this.metroHost === metroHost) return;
      // Metro bakes REACT_NATIVE_PACKAGER_HOSTNAME into bundle URLs at startup,
      // so after a network change (e.g. Wi-Fi -> hotspot) it keeps handing out
      // the old unreachable IP. Restart it with the current host.
      log.info('MobileGateway: restarting Expo Metro after LAN host change', {
        from: this.metroHost,
        to: metroHost,
      });
      await this.stopMetroAndWait();
    }

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
    this.metroHost = metroHost;
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

  // Stop the owned Metro and wait for it to exit so port 8081 is free before respawning.
  private async stopMetroAndWait(): Promise<void> {
    const child = this.metroProcess;
    this.disposeMetroProcess();
    if (!child || child.exitCode !== null || child.signalCode !== null) return;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          if (process.platform !== 'win32' && child.pid) {
            process.kill(-child.pid, 'SIGKILL');
          } else {
            child.kill('SIGKILL');
          }
        } catch {
          // already gone
        }
        resolve();
      }, METRO_STOP_TIMEOUT_MS);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private disposeMetroProcess(): void {
    const child = this.metroProcess;
    if (!child) return;
    this.metroProcess = null;
    this.metroHost = null;

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
    const networkUrls = mobileGatewayNetworkUrls(networkInterfaces(), this.port);
    const urls = networkUrls.map(({ url }) => url);
    const primaryUrl = urls[0] ?? `http://localhost:${this.port}`;
    return {
      enabled: shouldStartGateway(),
      running: Boolean(this.server),
      mode: isDevelopment() ? 'development' : 'production',
      host: this.host,
      port: this.port,
      token: this.token || null,
      urls,
      connectionKind: networkUrls[0]?.kind ?? 'local',
      localExpoUrl: this.token ? localExpoUrl(primaryUrl, this.token) : null,
      installUrl: mobileInstallUrl(),
      pairingUrl:
        this.server && this.token
          ? createMobilePairingUrl({ baseUrl: primaryUrl, token: this.token })
          : null,
    };
  }

  getRelayLoopbackConnection(): { baseUrl: string; token: string } | null {
    if (!this.server || !this.token) return null;
    return { baseUrl: `http://127.0.0.1:${this.port}`, token: this.token };
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

    if (req.method === 'GET' && url.pathname === '/v1/profile') {
      writeJson(res, 200, await this.getProfileSnapshot());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/configuration') {
      writeJson(res, 200, await this.getConfiguration());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/skills') {
      writeJson(res, 200, await this.getSkills());
      return;
    }

    const segments = pathSegments(url.pathname);
    const isAttachmentRoute = segments[0] === 'v1' && segments[1] === 'attachments';
    if (req.method === 'POST' && isAttachmentRoute && segments.length === 2) {
      const body = (await readJsonBody(req)) as MobileInputAttachmentCreateRequest;
      const response: MobileInputAttachmentCreateResponse =
        await this.requireAttachmentStore().create(body);
      writeJson(res, 201, response);
      return;
    }
    if (
      req.method === 'POST' &&
      isAttachmentRoute &&
      segments.length === 4 &&
      segments[2] &&
      segments[3] === 'chunks'
    ) {
      const body = (await readJsonBody(req)) as MobileInputAttachmentChunkRequest;
      writeJson(res, 200, await this.requireAttachmentStore().append(segments[2], body));
      return;
    }
    if (
      req.method === 'POST' &&
      isAttachmentRoute &&
      segments.length === 4 &&
      segments[2] &&
      segments[3] === 'complete'
    ) {
      const response: MobileInputAttachmentCompleteResponse = {
        attachment: await this.requireAttachmentStore().complete(segments[2]),
      };
      writeJson(res, 200, response);
      return;
    }
    if (
      req.method === 'POST' &&
      isAttachmentRoute &&
      segments.length === 4 &&
      segments[2] &&
      segments[3] === 'discard'
    ) {
      await this.requireAttachmentStore().discard(segments[2]);
      const response: MobileInputAttachmentDiscardResponse = { ok: true };
      writeJson(res, 200, response);
      return;
    }

    const isTaskSessionsRoute =
      segments[0] === 'v1' &&
      segments[1] === 'projects' &&
      Boolean(segments[2]) &&
      segments[3] === 'tasks' &&
      Boolean(segments[4]) &&
      segments[5] === 'sessions';

    const isProjectSkillsRoute =
      segments[0] === 'v1' &&
      segments[1] === 'projects' &&
      Boolean(segments[2]) &&
      segments[3] === 'skills';

    if (req.method === 'GET' && isProjectSkillsRoute && segments.length === 4) {
      writeJson(res, 200, await this.getSkills(segments[2]!));
      return;
    }

    if (req.method === 'GET' && isTaskSessionsRoute && segments.length === 6) {
      writeJson(res, 200, await this.getTaskSessions(segments[2]!, segments[4]!));
      return;
    }

    const isTaskActionsRoute =
      segments[0] === 'v1' &&
      segments[1] === 'projects' &&
      Boolean(segments[2]) &&
      segments[3] === 'tasks' &&
      Boolean(segments[4]) &&
      segments[5] === 'actions';

    if (req.method === 'POST' && isTaskActionsRoute && segments.length === 6) {
      const body = normalizeMobileTaskActionRequest(await readJsonBody(req));
      writeJson(res, 200, await this.performTaskAction(segments[2]!, segments[4]!, body));
      return;
    }

    if (req.method === 'GET' && isTaskSessionsRoute && segments.length === 7 && segments[6]) {
      writeJson(res, 200, await this.getSessionDetail(segments[2]!, segments[4]!, segments[6]));
      return;
    }

    if (
      req.method === 'GET' &&
      isTaskSessionsRoute &&
      segments.length === 8 &&
      segments[6] &&
      segments[7] === 'skills'
    ) {
      writeJson(res, 200, await this.getSkills(segments[2]!, segments[4]!, segments[6]));
      return;
    }

    if (
      req.method === 'GET' &&
      isTaskSessionsRoute &&
      segments.length === 8 &&
      segments[6] &&
      segments[7] === 'events'
    ) {
      await this.openSessionEvents(req, res, segments[2]!, segments[4]!, segments[6]);
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

    if (
      req.method === 'POST' &&
      isTaskSessionsRoute &&
      segments.length === 8 &&
      segments[6] &&
      segments[7] === 'config'
    ) {
      const body = normalizeSessionRuntimeConfigurationRequest(await readJsonBody(req));
      writeJson(
        res,
        200,
        await this.updateSessionRuntimeConfiguration(segments[2]!, segments[4]!, segments[6], body)
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
    return this.dashboardSnapshotCache.get(() => this.buildSnapshot());
  }

  private async buildSnapshot(): Promise<MobileDashboardSnapshot> {
    const [projects, activeTasks, taskActivityTimestamps] = await Promise.all([
      getProjects(),
      getAllActiveTasks(),
      getAllTaskActivityTimestamps(),
    ]);
    const projectActivityById = getMobileProjectActivityById(projects, taskActivityTimestamps);
    const mappedProjects = projects.map((project) =>
      this.mapProject(project, projectActivityById.get(project.id) ?? project.updatedAt)
    );
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

  private async getSkills(
    projectId?: string,
    taskId?: string,
    conversationId?: string
  ): Promise<MobileSkillsResponse> {
    let projectPath: string | undefined;
    let runtimeId = await appSettingsService.get('defaultRuntime');
    let allowedSkillKeys: Set<string> | null = null;

    if (projectId) {
      const project = await this.requireProject(projectId);
      projectPath = taskId ? this.resolveTaskCwd(project, taskId) : project.path;
    }

    if (projectId && taskId && conversationId) {
      const conversations = await getConversationsForTask(projectId, taskId);
      const conversation = conversations.find((candidate) => candidate.id === conversationId);
      if (!conversation) {
        throw new MobileGatewayError(404, 'session_not_found', 'Mobile session was not found.');
      }
      runtimeId = conversation.runtimeId;
      if (conversation.skillPolicy?.restriction === 'allowlist') {
        allowedSkillKeys = new Set(
          conversation.skillPolicy.entries.flatMap((entry) => [entry.key, entry.id])
        );
      }
    }

    const catalog = await skillsService.getCatalogIndex(projectPath);
    return {
      runtimeId,
      skills: mobileSkillSummaries(catalog, allowedSkillKeys),
    };
  }

  private async getConfiguration(): Promise<MobileConfigurationSnapshot> {
    const [defaultRuntimeId, configuredAgents, runtimePermissionModes, runtimeAutoApproveDefaults] =
      await Promise.all([
        appSettingsService.get('defaultRuntime'),
        agentsConfigService.list(),
        appSettingsService.get('runtimePermissionModes'),
        appSettingsService.get('runtimeAutoApproveDefaults'),
      ]);
    const agents = configuredAgents
      .filter(isMobileSelectableAgent)
      .map((agent) => mapMobileAgent(agent, defaultRuntimeId));
    const defaultAgent = configuredAgents.find(
      (agent) => agent.slug === BUILTIN_AGENT_KEYS.general && isMobileSelectableAgent(agent)
    );
    const permissionModes: MobileConfigurationSnapshot['permissionModes'] = {};
    const defaultPermissionModes: MobileConfigurationSnapshot['defaultPermissionModes'] = {};
    for (const runtimeId of RUNTIME_IDS) {
      permissionModes[runtimeId] = getRuntimePermissionModes(runtimeId).map((mode) =>
        mapMobilePermissionMode(runtimeId, mode)
      );
      defaultPermissionModes[runtimeId] = resolveRuntimePermissionModeId({
        selections: runtimePermissionModes,
        legacyAutoApprove: runtimeAutoApproveDefaults,
        runtimeId,
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      defaultRuntimeId,
      defaultAgentId: defaultAgent?.id ?? agents[0]?.id ?? null,
      runtimes: RUNTIME_IDS.map((runtimeId) => ({
        id: runtimeId,
        name: getRuntime(runtimeId)?.name ?? runtimeId,
      })),
      agents,
      permissionModes,
      defaultPermissionModes,
    };
  }

  private async getProfileSnapshot(): Promise<MobileProfileSnapshot> {
    const [session, settings, usage] = await Promise.all([
      yodaAccountService.getSession().catch((error: unknown): SessionState => {
        log.warn('MobileGateway: unable to load account profile', {
          error: error instanceof Error ? error.message : String(error),
        });
        return { user: null, isSignedIn: false, hasAccount: false };
      }),
      settingsSyncService.getStatus().catch((error: unknown): SettingsSyncStatus => {
        log.warn('MobileGateway: unable to load settings sync profile', {
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          signedIn: false,
          autoSyncEnabled: false,
          lastSyncedAt: null,
          cloudUpdatedAt: null,
        };
      }),
      getUsageOverview().catch((error: unknown) => {
        log.warn('MobileGateway: unable to load usage profile', {
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }),
    ]);
    const commerce = session.isSignedIn
      ? await yodaCommerceService.getSnapshot().catch((error: unknown) => {
          log.warn('MobileGateway: unable to load commerce profile', {
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        })
      : null;
    const user = session.user;

    return {
      generatedAt: new Date().toISOString(),
      account: {
        state: session.isSignedIn
          ? 'signed-in'
          : session.hasAccount
            ? 'session-expired'
            : 'signed-out',
        displayName: user?.name || user?.nickname || null,
        email: user?.email || null,
        avatarUrl: user?.avatarUrl || null,
      },
      usage: {
        totalTokens: usage?.tokens?.total ?? null,
        sessionCount:
          usage?.byRuntime.reduce((total, runtime) => total + runtime.sessionCount, 0) ?? 0,
        tasksTotal: usage?.tasksTotal ?? 0,
        tasksArchived: usage?.tasksArchived ?? 0,
        linesAdded: usage?.linesAdded ?? 0,
        linesDeleted: usage?.linesDeleted ?? 0,
      },
      cloud: {
        relay: commerce
          ? {
              status: commerce.relay.status,
              configured: commerce.relay.configured,
              accessEndsAt: commerce.relay.accessEndsAt,
              deviceCount: commerce.relay.devices.length,
              onlineDeviceCount: commerce.relay.devices.filter(
                (device) => device.status === 'online'
              ).length,
            }
          : null,
        settings,
      },
    };
  }

  private mapProject(project: Project, lastActivityAt: string): MobileProjectSummary {
    return {
      id: project.id,
      name: project.name,
      displayName: project.isInternal ? 'Default' : projectDisplayName(project),
      type: project.type,
      path: project.path,
      isInternal: project.isInternal,
      isOpen: Boolean(projectManager.getProject(project.id)),
      updatedAt: project.updatedAt,
      lastActivityAt,
    };
  }

  private mapTask(task: Task, activityStatus: MobileTaskActivityStatus): MobileTaskSummary {
    return {
      id: task.id,
      projectId: task.projectId,
      parentTaskId: task.parentTaskId,
      name: task.name,
      status: task.status,
      activityStatus,
      bootstrapStatus: taskManager.getBootstrapStatus(task.id),
      taskBranch: task.taskBranch,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      lastInteractedAt: task.lastInteractedAt,
      needsReview: task.needsReview,
      isPinned: task.isPinned,
      isFavorite: task.isFavorite,
      isLongTerm: task.isLongTerm,
      runtimeCounts: task.conversations,
      conversationCount: Object.values(task.conversations).reduce((sum, count) => sum + count, 0),
    };
  }

  private async performTaskAction(
    projectId: string,
    taskId: string,
    action: MobileTaskActionRequest
  ): Promise<MobileTaskActionResponse> {
    const task = (await getTasks(projectId)).find((candidate) => candidate.id === taskId);
    if (!task) {
      throw new MobileGatewayError(404, 'task_not_found', 'Task was not found.');
    }

    switch (action.action) {
      case 'archive':
        await archiveTask(projectId, taskId, undefined, { skipPreCommand: true });
        break;
      case 'set-pinned':
        await setTaskPinned(taskId, action.value);
        break;
      case 'set-favorite':
        await setTaskFavorite(taskId, action.value);
        break;
      case 'set-long-term':
        await setTaskLongTerm(taskId, action.value);
        break;
      case 'set-needs-review':
        await setTaskNeedsReview(taskId, action.value);
        break;
    }
    // Mobile refreshes the dashboard immediately after a mutation. Do not let
    // the short polling cache overwrite that optimistic state with old data.
    this.dashboardSnapshotCache.clear();

    return {
      ok: true,
      taskId,
      action: action.action,
      generatedAt: new Date().toISOString(),
    };
  }

  private async getTaskActivityStatuses(
    tasks: Task[]
  ): Promise<Map<string, MobileTaskActivityStatus>> {
    return resolveMobileTaskActivityStatuses({
      tasks,
      loadBatch: getActiveRuntimeStatuses,
      getBootstrapStatus: (taskId) => taskManager.getBootstrapStatus(taskId),
      loadFallback: (task) => this.getTaskActivityStatusFallback(task),
      onBatchError: (error) => {
        log.warn('MobileGateway: failed to load active runtime status batch', {
          error: String(error),
        });
      },
    });
  }

  private async getTaskActivityStatusFallback(task: Task): Promise<MobileTaskActivityStatus> {
    const bootstrapStatus = taskManager.getBootstrapStatus(task.id);
    const conversationCount = Object.values(task.conversations).reduce(
      (sum, count) => sum + count,
      0
    );
    if (conversationCount === 0) {
      return resolveTaskActivityStatus(task, [], bootstrapStatus);
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

    return resolveTaskActivityStatus(task, Object.values(runtimeByConversation), bootstrapStatus);
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

  /**
   * Canonical renderable session snapshot used by both the mobile detail API
   * and public session sharing.
   */
  async getSessionDetail(
    projectId: string,
    taskId: string,
    conversationId: string
  ): Promise<MobileSessionDetail> {
    return (await this.loadSessionDetailSource(projectId, taskId, conversationId)).detail;
  }

  async getSessionShareSource(
    projectId: string,
    taskId: string,
    conversationId: string
  ): Promise<{
    detail: MobileSessionDetail;
    cwd: string;
    embeddedImages: CodexRolloutShareImageGroup[];
  }> {
    const source = await this.loadSessionDetailSource(projectId, taskId, conversationId);
    const embeddedImages =
      source.conversation.runtimeId === 'codex'
        ? await loadCodexRolloutShareImagesTailForConversation({
            conversation: source.conversation,
            cwd: source.cwd,
          }).catch((error: unknown) => {
            log.warn('MobileGateway: failed to load embedded session images', {
              conversationId: source.conversation.id,
              error: String(error),
            });
            return [];
          })
        : [];
    return { detail: source.detail, cwd: source.cwd, embeddedImages };
  }

  private async loadSessionDetailSource(
    projectId: string,
    taskId: string,
    conversationId: string
  ): Promise<{ detail: MobileSessionDetail; cwd: string; conversation: Conversation }> {
    const data = await this.loadTaskSessionData(projectId, taskId);
    const conversation = data.conversations.find((item) => item.id === conversationId);
    const session = data.sessions.find((item) => item.id === conversationId);

    if (!conversation || !session) {
      throw new MobileGatewayError(404, 'session_not_found', 'Mobile session was not found.');
    }

    const ptySessionId = makePtySessionId(projectId, taskId, conversationId);
    const [output, transcript, runtimeConfiguration] = await Promise.all([
      this.readConversationOutput(conversation, data.cwd, ptySessionId),
      this.readConversationTranscript(conversation, data.cwd, session.sessionId),
      this.resolveSessionRuntimeConfiguration(conversation, data.cwd, session.sessionId),
    ]);
    const tailed = tailSessionContent(output.content);
    const tailedTranscript = tailSessionTranscript(transcript);
    const pendingInteraction = resolveMobileSessionInteraction({
      content: tailed.content,
      runtimeId: session.runtimeId,
      runtimeStatus: session.runtimeStatus,
      transcript,
    });

    return {
      cwd: data.cwd,
      conversation,
      detail: {
        generatedAt: new Date().toISOString(),
        session: {
          ...session,
          model: runtimeConfiguration.model,
          reasoningEffort: runtimeConfiguration.reasoningEffort,
        },
        content: tailed.content,
        contentLength: tailed.contentLength,
        truncated: tailed.truncated,
        source: output.source,
        transcript: tailedTranscript.transcript,
        transcriptTruncated: tailedTranscript.truncated,
        pendingInteraction,
      },
    };
  }

  private async openSessionEvents(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    projectId: string,
    taskId: string,
    conversationId: string
  ): Promise<void> {
    const lifecycleGeneration = this.lifecycleGeneration;
    const activeServer = this.server;
    const conversations = await getConversationsForTask(projectId, taskId);
    if (!this.isActiveLifecycle(lifecycleGeneration, activeServer)) {
      if (!res.destroyed && !res.writableEnded) res.end();
      return;
    }
    if (!conversations.some((conversation) => conversation.id === conversationId)) {
      throw new MobileGatewayError(404, 'session_not_found', 'Mobile session was not found.');
    }

    let cleaned = false;
    let unsubscribeRuntime: (() => void) | null = null;
    let unsubscribeTranscript: (() => void) | null = null;
    const streamHolder: { current: MobileSessionEventStream | null } = { current: null };
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      unsubscribeRuntime?.();
      unsubscribeTranscript?.();
      if (streamHolder.current) this.sessionEventStreams.delete(streamHolder.current);
    };

    const stream = new MobileSessionEventStream(req, res, () => this.nextSessionEventId(), cleanup);
    streamHolder.current = stream;
    this.sessionEventStreams.add(stream);
    const sendInvalidation = (
      reason: MobileSessionInvalidationReason,
      runtimeStatus?: AgentSessionRuntimeStatus,
      retry?: number
    ) => {
      stream.send(
        {
          version: MOBILE_SESSION_EVENT_VERSION,
          conversationId,
          reason,
          emittedAt: new Date().toISOString(),
          ...(runtimeStatus === undefined ? {} : { runtimeStatus }),
        },
        retry
      );
    };

    unsubscribeRuntime = agentSessionRuntimeStore.subscribe(
      { projectId, taskId, conversationId },
      (state) => sendInvalidation('status-changed', state.status)
    );

    try {
      const transcriptSubscription = await subscribeConversationTranscriptChanges(
        projectId,
        taskId,
        conversationId,
        () => sendInvalidation('transcript-changed')
      );
      if (stream.isClosed || !this.isActiveLifecycle(lifecycleGeneration, activeServer)) {
        transcriptSubscription();
        stream.close();
        return;
      }
      unsubscribeTranscript = transcriptSubscription;
      if (!stream.start()) {
        stream.close();
        return;
      }
      sendInvalidation('connected', undefined, MOBILE_SESSION_RECONNECT_RETRY_MS);
    } catch (error) {
      const connectionClosed = stream.isClosed || res.destroyed || res.writableEnded;
      stream.close(false);
      if (connectionClosed) return;
      throw error;
    }
  }

  private nextSessionEventId(): string {
    this.sessionEventSequence += 1;
    return `${this.sessionEventEpoch}:${this.sessionEventSequence}`;
  }

  private isActiveLifecycle(generation: number, server: http.Server | null): boolean {
    return server !== null && this.server === server && this.lifecycleGeneration === generation;
  }

  private async sendSessionInput(
    projectId: string,
    taskId: string,
    conversationId: string,
    params: MobileSessionInputRequest
  ): Promise<MobileSessionInputResponse> {
    const requestId = params.clientRequestId;
    if (!requestId) {
      return this.deliverSessionInput(projectId, taskId, conversationId, params);
    }

    const key = `${projectId}:${taskId}:${conversationId}:${requestId}`;
    const signature = JSON.stringify({
      attachmentIds: params.attachmentIds ?? [],
      input: params.input,
      submit: params.submit !== false,
    });
    try {
      return await this.sessionInputRequests.run(key, signature, () =>
        this.deliverSessionInput(projectId, taskId, conversationId, params)
      );
    } catch (error) {
      log.warn('MobileGateway: session input request failed', {
        requestId,
        projectId,
        taskId,
        conversationId,
        error: String(error),
      });
      if (error instanceof MobileSessionInputRequestConflictError) {
        throw new MobileGatewayError(409, 'request_id_conflict', error.message);
      }
      throw error;
    }
  }

  private async deliverSessionInput(
    projectId: string,
    taskId: string,
    conversationId: string,
    params: MobileSessionInputRequest
  ): Promise<MobileSessionInputResponse> {
    const data = await this.loadTaskSessionData(projectId, taskId);
    const conversation = data.conversations.find((item) => item.id === conversationId);
    const session = data.sessions.find((item) => item.id === conversationId);

    if (!conversation || !session) {
      throw new MobileGatewayError(404, 'session_not_found', 'Mobile session was not found.');
    }

    if (!canContinueMobileSession(session)) {
      throw new MobileGatewayError(
        409,
        'session_not_resumable',
        'This session does not support follow-up input.'
      );
    }

    const attachmentIds = params.attachmentIds ?? [];
    const attachments = this.requireAttachmentStore().resolve(attachmentIds);
    if (attachments.length > 0) {
      const project = await this.requireProject(projectId);
      if (project.type !== 'local') {
        throw new MobileGatewayError(
          400,
          'attachments_ssh_unsupported',
          'Image input is available for local projects only.'
        );
      }
      if (params.submit === false) {
        throw new MobileGatewayError(
          400,
          'attachments_require_submit',
          'Image input must be submitted in the same request.'
        );
      }
    }

    await this.ensureConversationInputSession(projectId, taskId, conversationId);
    const sent = await submitMobileSessionInput({
      imagePaths: attachments.map((attachment) => attachment.filePath),
      input:
        attachments.length > 0
          ? promptWithImageMarkers(params.input, attachments.length)
          : params.input,
      submit: params.submit !== false,
      target: { projectId, taskId, conversationId, runtime: conversation.runtimeId },
      injectPrompt: (input) =>
        input.imagePaths.length > 0
          ? injectConversationPrompt(input)
          : injectPromptUsingWriter(
              { projectId, taskId, conversationId },
              conversation.runtimeId,
              input.prompt,
              (data) => this.writeConversationInput(projectId, taskId, conversationId, data)
            ),
      writeInput: (data) => this.writeConversationInput(projectId, taskId, conversationId, data),
    });
    if (!sent) {
      throw new MobileGatewayError(
        409,
        'session_not_live',
        'This session is not currently accepting input.'
      );
    }

    if (attachmentIds.length > 0) this.requireAttachmentStore().release(attachmentIds);

    log.info('MobileGateway: session input accepted', {
      requestId: params.clientRequestId ?? '<legacy-client>',
      projectId,
      taskId,
      conversationId,
      attachmentCount: attachmentIds.length,
    });

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      requestId: params.clientRequestId,
    };
  }

  private async ensureConversationInputSession(
    projectId: string,
    taskId: string,
    conversationId: string
  ): Promise<void> {
    await this.ensureProjectOpen(projectId);
    try {
      const ready = await ensureMobileConversationInputSession({
        projectId,
        taskId,
        conversationId,
      });
      if (ready) return;
    } catch (error) {
      log.warn('MobileGateway: failed to restore session for input', {
        projectId,
        taskId,
        conversationId,
        error: String(error),
      });
    }

    throw new MobileGatewayError(
      409,
      'session_resume_failed',
      'This session could not be resumed for follow-up input.'
    );
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
    const availability = resolveMobileSessionAvailability(
      sessionInfo,
      Boolean(ptySessionRegistry.get(ptySessionId))
    );

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
      ...availability,
      tmuxEnabled: sessionInfo?.tmuxEnabled ?? false,
      sessionId: sessionInfo?.sessionId ?? conversation.id,
      sessionTitle: sessionInfo?.sessionTitle,
      agent: mapSessionAgent(
        conversation,
        getRuntime(conversation.runtimeId)?.name ?? conversation.runtimeId
      ),
      model: conversation.runtimeOverrides?.model ?? null,
      reasoningEffort: conversation.runtimeOverrides?.reasoningEffort ?? null,
      permissionMode:
        conversation.permissionMode ?? conversation.runtimeOverrides?.permissionMode ?? null,
    };
  }

  private async resolveSessionRuntimeConfiguration(
    conversation: Conversation,
    cwd: string,
    sessionId: string
  ): Promise<{ model: string | null; reasoningEffort: string | null }> {
    let model = conversation.runtimeOverrides?.model ?? null;
    let reasoningEffort = conversation.runtimeOverrides?.reasoningEffort ?? null;
    if (conversation.runtimeId === 'codex') {
      const context = await getCodexSessionContext(
        cwd,
        conversation.id,
        conversation.title,
        conversation.createdAt,
        { transcriptMode: 'harness', conversationLastInteractedAt: conversation.lastInteractedAt }
      ).catch((error: unknown) => {
        log.warn('MobileGateway: failed to load Codex runtime configuration', {
          conversationId: conversation.id,
          error: String(error),
        });
        return null;
      });
      model = context?.model ?? model;
      reasoningEffort = context?.turnContexts.at(-1)?.effort ?? reasoningEffort;
    } else if (conversation.runtimeId === 'claude') {
      const metadata = await getClaudeSessionMetadata(cwd, sessionId).catch((error: unknown) => {
        log.warn('MobileGateway: failed to load Claude runtime configuration', {
          conversationId: conversation.id,
          error: String(error),
        });
        return null;
      });
      model = metadata?.model ?? model;
    }
    return { model, reasoningEffort };
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
      const history = await loadCodexRolloutTerminalHistoryTailForConversation({
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

    const transcript = await loadCodexRolloutTranscriptTailForConversation({
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

  private async resolveMobileAgent(agentId: string | null | undefined): Promise<Agent | null> {
    if (agentId === null) return null;
    const agent = agentId
      ? await agentsConfigService.get(agentId)
      : ((await agentsConfigService.getBySlug(BUILTIN_AGENT_KEYS.general)) ??
        (await agentsConfigService.list()).find(isMobileSelectableAgent));
    if (!agent || !isMobileSelectableAgent(agent)) {
      throw new MobileGatewayError(404, 'agent_not_found', 'Selected Agent was not found.');
    }
    return agent;
  }

  private async createDemand(
    params: MobileCreateDemandRequest
  ): Promise<MobileCreateDemandResponse> {
    const projectId = params.projectId || INTERNAL_PROJECT_ID;
    const project = await this.ensureProjectOpen(projectId);
    const attachmentIds = params.attachmentIds ?? [];
    const attachments = this.requireAttachmentStore().resolve(attachmentIds);
    if (attachments.length > 0 && project.type !== 'local') {
      throw new MobileGatewayError(
        400,
        'attachments_ssh_unsupported',
        'Image input is available for local projects only.'
      );
    }
    const agent = await this.resolveMobileAgent(params.agentId);
    const provider = await this.resolveProvider(
      params.provider ?? agent?.preferredRuntime ?? undefined
    );
    const permissionMode =
      params.permissionMode ??
      (agent ? resolveAgentPermissionMode(provider, agent.accessMode) : undefined);
    if (
      permissionMode &&
      !getRuntimePermissionModes(provider).some((mode) => mode.id === permissionMode)
    ) {
      throw new MobileGatewayError(
        400,
        'invalid_configuration',
        `Unsupported permission mode for ${provider}.`
      );
    }
    const model = params.model !== undefined ? params.model : agent?.model;
    const reasoningEffort =
      params.reasoningEffort !== undefined ? params.reasoningEffort : agent?.reasoningEffort;
    const promptBody = promptWithImageMarkers(params.prompt, attachments.length);
    const initialPrompt = withSystemPrompt(
      agent?.systemPrompt ?? '',
      params.runMode === 'brainstorm'
        ? [
            '请先进行方案讨论，不要直接修改文件。',
            '先梳理目标、关键决策、实现步骤和验收方式，再等待用户确认。',
            '',
            promptBody,
          ].join('\n')
        : promptBody
    );
    const taskId = randomUUID();
    const conversationId = randomUUID();
    const existingTaskNames = (await getTasks(projectId)).map((task) => task.name);
    const generatedName = generateTaskName({
      title: params.title || params.prompt || 'Image request',
    });
    const taskName = ensureUniqueTaskSlug(generatedName, existingTaskNames);
    const sourceBranch = await this.resolveSourceBranch(project, projectId);
    const strategy =
      params.strategyKind === 'new-branch'
        ? { kind: 'new-branch' as const, taskBranch: taskName }
        : { kind: 'no-worktree' as const };
    const skillSelection = agent
      ? normalizeSkillSelection({
          restriction: agent.skillPolicyMode === 'allowlist' ? 'allowlist' : undefined,
          autoSkillKeys: agent.enabledSkillIds,
          manualSkillKeys: agent.manualSkillIds,
        })
      : undefined;

    const result = await createTask({
      id: taskId,
      projectId,
      name: taskName,
      sourceBranch,
      strategy,
      parentTaskId: params.parentTaskId,
      initialConversation: {
        id: conversationId,
        projectId,
        taskId,
        runtime: provider,
        title: taskNameFromPrompt(params.prompt) || 'Mobile image request',
        clientSource: 'mobile',
        initialPrompt,
        imagePaths: attachments.map((attachment) => attachment.filePath),
        agent: agent
          ? { id: agent.id, name: agent.name, icon: agent.icon || undefined }
          : undefined,
        model,
        reasoningEffort,
        permissionMode,
        skillSelection,
      },
    });

    if (!result.success) {
      throw new MobileGatewayError(422, 'create_task_failed', mapCreateTaskError(result.error));
    }

    this.dashboardSnapshotCache.clear();
    this.requireAttachmentStore().release(attachmentIds);

    return {
      task: this.mapTask(
        result.data.task,
        resolveTaskActivityStatus(
          result.data.task,
          [],
          taskManager.getBootstrapStatus(result.data.task.id)
        )
      ),
      sessionId: conversationId,
      warning: result.data.warning ? mapCreateTaskWarning(result.data.warning) : undefined,
    };
  }

  private async updateSessionRuntimeConfiguration(
    projectId: string,
    taskId: string,
    conversationId: string,
    update: MobileSessionRuntimeConfigurationUpdate
  ): Promise<MobileSessionRuntimeConfigurationResponse> {
    await this.ensureProjectOpen(projectId);
    const conversations = await getConversationsForTask(projectId, taskId);
    const conversation = conversations.find((candidate) => candidate.id === conversationId);
    if (!conversation) {
      throw new MobileGatewayError(404, 'session_not_found', 'Mobile session was not found.');
    }
    if (
      update.permissionMode &&
      !getRuntimePermissionModes(conversation.runtimeId).some(
        (mode) => mode.id === update.permissionMode
      )
    ) {
      throw new MobileGatewayError(
        400,
        'invalid_configuration',
        `Unsupported permission mode for ${conversation.runtimeId}.`
      );
    }

    await restartConversation(projectId, taskId, conversationId, undefined, undefined, undefined, {
      model: update.model,
      reasoningEffort: update.reasoningEffort,
      permissionMode: update.permissionMode,
    });
    return { ok: true, generatedAt: new Date().toISOString() };
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

  private requireAttachmentStore(): MobileInputAttachmentStore {
    if (!this.attachmentStore) {
      throw new MobileGatewayError(
        503,
        'attachment_store_unavailable',
        'Mobile image input is not initialized.'
      );
    }
    return this.attachmentStore;
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
