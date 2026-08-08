import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveCommandPath } from '@main/core/dependencies/probe';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { buildExternalToolEnv } from '@main/utils/childProcessEnv';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 30_000;
const AUTHORIZATION_TIMEOUT_MS = 90_000;
const TASK_READ_SCOPE = 'task:task:read';

type CliErrorPayload = {
  message?: string;
  hint?: string;
  missing_scopes?: string[];
};

type CliEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: CliErrorPayload;
};

export type FeishuAuthStatus = {
  identity?: string;
  verified?: boolean;
  identities?: {
    user?: {
      available?: boolean;
      verified?: boolean;
      userName?: string;
      openId?: string;
      scope?: string;
    };
  };
};

export type FeishuTaskMember = {
  id?: string;
  name?: string;
  role?: string;
  type?: string;
};

export type FeishuTaskSummary = {
  guid?: string;
  summary?: string;
  url?: string;
  completed?: boolean;
  created_at?: string;
  completed_at?: string;
  updated_at?: string;
  due_at?: string;
};

export type FeishuTaskDetail = FeishuTaskSummary & {
  description?: string;
  status?: string;
  members?: FeishuTaskMember[];
  creator?: FeishuTaskMember;
  tasklists?: Array<{ tasklist_guid?: string; section_guid?: string }>;
};

type TaskListData = {
  items?: FeishuTaskSummary[];
};

type TaskDetailData = {
  task?: FeishuTaskDetail;
};

type AuthorizationStartData = {
  verification_url?: string;
  device_code?: string;
};

function parseJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function cliErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const envelope = payload as CliEnvelope<unknown>;
  const message = envelope.error?.message;
  const hint = envelope.error?.hint;
  if (message && hint) return `${message}\n${hint}`;
  return message || hint || fallback;
}

export interface FeishuTaskClient {
  authStatus(): Promise<FeishuAuthStatus>;
  listTasks(limit: number): Promise<FeishuTaskSummary[]>;
  searchTasks(searchTerm: string, limit: number): Promise<FeishuTaskSummary[]>;
  getTask(guid: string): Promise<FeishuTaskDetail | undefined>;
}

type LarkCliClientDependencies = {
  resolveExecutable?: () => Promise<string>;
  execute?: (
    executable: string,
    args: string[],
    timeout: number
  ) => Promise<{ stdout: string; stderr: string }>;
};

async function resolveLarkCliExecutable(): Promise<string> {
  const context = new LocalExecutionContext();
  try {
    const executable = await resolveCommandPath('lark-cli', context);
    if (!executable) {
      throw new Error('未找到 lark-cli，请先安装并配置飞书 CLI。');
    }
    return executable;
  } finally {
    context.dispose();
  }
}

async function executeLarkCli(
  executable: string,
  args: string[],
  timeout: number
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(executable, args, {
    encoding: 'utf8',
    timeout,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...buildExternalToolEnv(),
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
    },
  }) as Promise<{ stdout: string; stderr: string }>;
}

export class LarkCliClient implements FeishuTaskClient {
  private executablePromise: Promise<string> | undefined;
  private pendingDeviceCode: string | undefined;

  constructor(private readonly dependencies: LarkCliClientDependencies = {}) {}

  private async executable(): Promise<string> {
    if (!this.executablePromise) {
      this.executablePromise = (this.dependencies.resolveExecutable ?? resolveLarkCliExecutable)();
    }
    return this.executablePromise;
  }

  private async runJson(args: string[], timeout = DEFAULT_TIMEOUT_MS): Promise<unknown> {
    const executable = await this.executable();
    try {
      const result = await (this.dependencies.execute ?? executeLarkCli)(executable, args, timeout);
      const parsed = parseJson(result.stdout);
      if (parsed === undefined) {
        throw new Error(result.stderr.trim() || 'lark-cli 返回了空响应。');
      }
      return parsed;
    } catch (error) {
      const processError = error as { stdout?: string; stderr?: string; message?: string };
      const payload = parseJson(processError.stderr ?? '') ?? parseJson(processError.stdout ?? '');
      throw new Error(cliErrorMessage(payload, processError.message || 'lark-cli 调用失败。'));
    }
  }

  private async runEnvelope<T>(args: string[], timeout?: number): Promise<T> {
    const payload = (await this.runJson(args, timeout)) as CliEnvelope<T>;
    if (!payload.ok || payload.data === undefined) {
      throw new Error(cliErrorMessage(payload, '飞书 CLI 请求失败。'));
    }
    return payload.data;
  }

  async authStatus(): Promise<FeishuAuthStatus> {
    return (await this.runJson(['auth', 'status', '--json', '--verify'])) as FeishuAuthStatus;
  }

  async listTasks(limit: number): Promise<FeishuTaskSummary[]> {
    const pageLimit = Math.min(40, Math.max(1, Math.ceil(limit / 50)));
    const data = await this.runEnvelope<TaskListData>([
      'task',
      '+get-my-tasks',
      '--complete=false',
      '--page-limit',
      String(pageLimit),
      '--json',
    ]);
    return (data.items ?? []).slice(0, limit);
  }

  async searchTasks(searchTerm: string, limit: number): Promise<FeishuTaskSummary[]> {
    const pageLimit = Math.min(40, Math.max(1, Math.ceil(limit / 50)));
    const data = await this.runEnvelope<TaskListData>([
      'task',
      '+search',
      '--query',
      searchTerm,
      '--completed=false',
      '--page-limit',
      String(pageLimit),
      '--json',
    ]);
    return (data.items ?? []).slice(0, limit);
  }

  async getTask(guid: string): Promise<FeishuTaskDetail | undefined> {
    const data = await this.runEnvelope<TaskDetailData>([
      'task',
      'tasks',
      'get',
      '--task-guid',
      guid,
      '--user-id-type',
      'open_id',
      '--format',
      'json',
    ]);
    return data.task;
  }

  async startAuthorization(): Promise<{ verificationUrl: string }> {
    const payload = (await this.runJson([
      'auth',
      'login',
      '--scope',
      TASK_READ_SCOPE,
      '--no-wait',
      '--json',
    ])) as AuthorizationStartData;
    if (!payload.verification_url || !payload.device_code) {
      throw new Error('飞书 CLI 未返回授权链接，请检查当前 profile 配置。');
    }
    this.pendingDeviceCode = payload.device_code;
    return { verificationUrl: payload.verification_url };
  }

  async completeAuthorization(): Promise<FeishuAuthStatus> {
    if (!this.pendingDeviceCode) {
      throw new Error('当前没有待完成的飞书授权，请重新发起连接。');
    }
    await this.runJson(
      ['auth', 'login', '--device-code', this.pendingDeviceCode, '--json'],
      AUTHORIZATION_TIMEOUT_MS
    );
    this.pendingDeviceCode = undefined;
    return this.authStatus();
  }
}

export const larkCliClient = new LarkCliClient();
