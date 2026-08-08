import { ISSUE_PROVIDER_CAPABILITIES, type IssueListResult } from '@shared/issue-providers';
import type { Issue } from '@shared/tasks';
import { clampIssueLimit, normalizeSearchTerm } from '@main/core/issues/helpers/provider-inputs';
import type { IssueProvider } from '@main/core/issues/issue-provider';
import { log } from '@main/lib/logger';
import {
  larkCliClient,
  type FeishuTaskClient,
  type FeishuTaskDetail,
  type FeishuTaskSummary,
} from './lark-cli-client';

const FEISHU_TASK_READ_SCOPE = 'task:task:read';
const UNTITLED_FEISHU_TASK = 'Untitled Feishu task';

function timestampToIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) {
    const timestamp = Number(value);
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function taskUrl(task: FeishuTaskSummary): string {
  return (
    task.url ||
    `https://applink.feishu.cn/client/todo/task?guid=${encodeURIComponent(task.guid ?? '')}`
  );
}

function taskAssignees(task: FeishuTaskDetail): string[] | undefined {
  const names = (task.members ?? [])
    .map((member) => member.name?.trim())
    .filter((name): name is string => !!name);
  return names.length ? [...new Set(names)] : undefined;
}

function toIssue(task: FeishuTaskSummary | FeishuTaskDetail): Issue | undefined {
  if (!task.guid) return undefined;
  const detail = task as FeishuTaskDetail;
  return {
    provider: 'feishu',
    identifier: task.guid,
    title: task.summary?.trim() || UNTITLED_FEISHU_TASK,
    url: taskUrl(task),
    description: detail.description?.trim() || undefined,
    status: task.completed ? 'done' : detail.status || 'todo',
    assignees: taskAssignees(detail),
    project: detail.tasklists?.length ? 'Feishu Tasks' : undefined,
    updatedAt: timestampToIso(task.updated_at ?? task.created_at),
    fetchedAt: new Date().toISOString(),
  };
}

function mapIssues(tasks: Array<FeishuTaskSummary | FeishuTaskDetail>): Issue[] {
  return tasks.map(toIssue).filter((issue): issue is Issue => !!issue);
}

export function createFeishuIssueProvider(client: FeishuTaskClient): IssueProvider {
  return {
    type: 'feishu',
    capabilities: ISSUE_PROVIDER_CAPABILITIES.feishu,
    checkConnection: async () => {
      try {
        const status = await client.authStatus();
        const user = status.identities?.user;
        const scopes = new Set((user?.scope ?? '').split(/\s+/).filter(Boolean));
        if (!status.verified || !user?.available || !user.verified) {
          return {
            connected: false,
            error: '飞书 CLI 用户身份尚未就绪。',
            capabilities: ISSUE_PROVIDER_CAPABILITIES.feishu,
          };
        }
        if (!scopes.has(FEISHU_TASK_READ_SCOPE)) {
          return {
            connected: false,
            displayName: user.userName,
            error: '需要授权飞书任务只读权限。',
            capabilities: ISSUE_PROVIDER_CAPABILITIES.feishu,
          };
        }
        return {
          connected: true,
          displayName: user.userName || 'Feishu · lark-cli',
          capabilities: ISSUE_PROVIDER_CAPABILITIES.feishu,
        };
      } catch (error) {
        return {
          connected: false,
          error: error instanceof Error ? error.message : '飞书 CLI 连接检查失败。',
          capabilities: ISSUE_PROVIDER_CAPABILITIES.feishu,
        };
      }
    },
    listIssues: async (opts): Promise<IssueListResult> => {
      try {
        const limit = clampIssueLimit(opts.limit, 50, 200);
        return { success: true, issues: mapIssues(await client.listTasks(limit)) };
      } catch (error) {
        log.error('[FeishuIssueProvider] Failed to list tasks', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : '读取飞书任务失败。',
        };
      }
    },
    searchIssues: async (opts): Promise<IssueListResult> => {
      const searchTerm = normalizeSearchTerm(opts.searchTerm);
      if (!searchTerm) return { success: true, issues: [] };
      try {
        const limit = clampIssueLimit(opts.limit, 20, 200);
        return {
          success: true,
          issues: mapIssues(await client.searchTasks(searchTerm, limit)),
        };
      } catch (error) {
        log.error('[FeishuIssueProvider] Failed to search tasks', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : '搜索飞书任务失败。',
        };
      }
    },
    hydrateIssue: async (issue) => {
      try {
        const task = await client.getTask(issue.identifier);
        return task ? (toIssue(task) ?? issue) : issue;
      } catch (error) {
        log.warn('[FeishuIssueProvider] Failed to hydrate task', error);
        return issue;
      }
    },
  };
}

export const feishuIssueProvider = createFeishuIssueProvider(larkCliClient);
