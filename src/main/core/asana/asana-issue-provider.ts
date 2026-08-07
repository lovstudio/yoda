import { ISSUE_PROVIDER_CAPABILITIES, type IssueListResult } from '@shared/issue-providers';
import type { Issue } from '@shared/tasks';
import { clampIssueLimit, normalizeSearchTerm } from '@main/core/issues/helpers/provider-inputs';
import type { IssueProvider } from '@main/core/issues/issue-provider';
import { log } from '@main/lib/logger';
import {
  createAsanaClient,
  type AsanaResponse,
  type AsanaUser,
  type RawAsanaTask,
} from './asana-client';
import { asanaConnectionService } from './asana-connection-service';

function toIssue(task: RawAsanaTask): Issue | null {
  if (!task.gid) return null;
  const projectName =
    task.projects?.find((project) => project.name)?.name ??
    task.memberships?.find((membership) => membership.project?.name)?.project?.name;
  const sectionName = task.memberships?.find((membership) => membership.section?.name)?.section
    ?.name;

  return {
    provider: 'asana',
    identifier: task.gid,
    title: task.name ?? '',
    url: task.permalink_url ?? '',
    description: task.notes?.trim() || undefined,
    status: sectionName ?? (task.completed ? 'Completed' : undefined),
    assignees: task.assignee?.name ? [task.assignee.name] : undefined,
    project: projectName,
    updatedAt: task.modified_at,
    fetchedAt: new Date().toISOString(),
  };
}

async function getClientAndWorkspace() {
  const credentials = await asanaConnectionService.getCredentials();
  if (!credentials) return null;
  const client = createAsanaClient(credentials);
  const response = (await client.getUser()) as AsanaResponse<AsanaUser>;
  const workspace = response.data?.workspaces?.[0];
  if (!workspace?.gid) throw new Error('No Asana workspace is available for this account.');
  return { client, workspace };
}

async function listIssues(limit: number): Promise<IssueListResult> {
  try {
    const resolved = await getClientAndWorkspace();
    if (!resolved) {
      return { success: false, error: 'Asana is not configured. Connect Asana in settings.' };
    }
    const response = (await resolved.client.getTasks({
      workspace: resolved.workspace.gid,
      limit: clampIssueLimit(limit, 50, 100),
    })) as AsanaResponse<RawAsanaTask[]>;
    return {
      success: true,
      issues: (response.data ?? []).map(toIssue).filter((issue): issue is Issue => issue !== null),
    };
  } catch (error) {
    return {
      success: false,
      error: asanaConnectionService.errorMessage(error, 'Unable to fetch Asana tasks.'),
    };
  }
}

async function searchIssues(searchTerm: string, limit: number): Promise<IssueListResult> {
  const term = normalizeSearchTerm(searchTerm);
  if (!term) return { success: true, issues: [] };
  try {
    const resolved = await getClientAndWorkspace();
    if (!resolved) {
      return { success: false, error: 'Asana is not configured. Connect Asana in settings.' };
    }
    const response = (await resolved.client.searchTasks(resolved.workspace.gid, {
      text: term,
      limit: clampIssueLimit(limit, 20, 100),
    })) as AsanaResponse<RawAsanaTask[]>;
    return {
      success: true,
      issues: (response.data ?? []).map(toIssue).filter((issue): issue is Issue => issue !== null),
    };
  } catch (error) {
    log.error('[Asana] searchIssues error:', error);
    return {
      success: false,
      error: asanaConnectionService.errorMessage(error, 'Unable to search Asana tasks.'),
    };
  }
}

export const asanaIssueProvider: IssueProvider = {
  type: 'asana',
  capabilities: ISSUE_PROVIDER_CAPABILITIES.asana,
  checkConnection: () => asanaConnectionService.checkConnection(),
  listIssues: async (opts) => listIssues(opts.limit ?? 50),
  searchIssues: async (opts) => searchIssues(opts.searchTerm, opts.limit ?? 20),
};
