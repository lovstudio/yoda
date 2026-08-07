import type { Project, WorkItem, WorkItemSearchItem } from '@makeplane/plane-node-sdk';
import { ISSUE_PROVIDER_CAPABILITIES, type IssueListResult } from '@shared/issue-providers';
import type { Issue } from '@shared/tasks';
import { clampIssueLimit, normalizeSearchTerm } from '@main/core/issues/helpers/provider-inputs';
import type { IssueProvider } from '@main/core/issues/issue-provider';
import { log } from '@main/lib/logger';
import { createPlaneClient, planeIssueUrl, type PlaneCredentials } from './plane-client';
import { planeConnectionService } from './plane-connection-service';

function stripHtml(value: string | null | undefined): string | undefined {
  const stripped = value
    ?.replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || undefined;
}

function identifierFor(
  projectIdentifier: string | undefined,
  sequenceId: number | string | undefined,
  fallback: string
): string {
  const sequence = sequenceId == null ? undefined : String(sequenceId);
  return projectIdentifier && sequence
    ? `${projectIdentifier}-${sequence}`
    : (sequence ?? fallback);
}

function toIssue(item: WorkItem, project: Project, credentials: PlaneCredentials): Issue {
  const identifier = identifierFor(project.identifier, item.sequence_id, item.id);
  return {
    provider: 'plane',
    identifier,
    title: item.name ?? identifier,
    url: planeIssueUrl(credentials, identifier),
    description: item.description_stripped ?? stripHtml(item.description_html),
    project: project.name ?? project.identifier,
    updatedAt: String(item.updated_at ?? item.created_at ?? '') || undefined,
    fetchedAt: new Date().toISOString(),
  };
}

function toSearchIssue(item: WorkItemSearchItem, credentials: PlaneCredentials): Issue {
  const identifier = identifierFor(item.project__identifier, item.sequence_id, item.id);
  return {
    provider: 'plane',
    identifier,
    title: item.name,
    url: planeIssueUrl(credentials, identifier),
    project: item.project__identifier,
    fetchedAt: new Date().toISOString(),
  };
}

async function listIssues(limit: number): Promise<IssueListResult> {
  const credentials = await planeConnectionService.getCredentials();
  if (!credentials) {
    return { success: false, error: 'Plane is not configured. Connect Plane in settings.' };
  }
  const requestedLimit = clampIssueLimit(limit, 50, 100);
  try {
    const client = createPlaneClient(credentials);
    const projects = await client.projects.list(credentials.workspaceSlug, { limit: 10 });
    const issues: Issue[] = [];
    for (const project of projects.results) {
      if (issues.length >= requestedLimit) break;
      const items = await client.workItems.list(credentials.workspaceSlug, project.id, {
        limit: Math.min(requestedLimit - issues.length, 50),
      });
      issues.push(...items.results.map((item) => toIssue(item, project, credentials)));
    }
    return { success: true, issues: issues.slice(0, requestedLimit) };
  } catch (error) {
    return {
      success: false,
      error: planeConnectionService.errorMessage(error, 'Unable to fetch Plane work items.'),
    };
  }
}

async function searchIssues(searchTerm: string, limit: number): Promise<IssueListResult> {
  const term = normalizeSearchTerm(searchTerm);
  if (term.length < 2) return { success: true, issues: [] };
  const credentials = await planeConnectionService.getCredentials();
  if (!credentials) {
    return { success: false, error: 'Plane is not configured. Connect Plane in settings.' };
  }
  try {
    const result = await createPlaneClient(credentials).workItems.search(
      credentials.workspaceSlug,
      term,
      undefined,
      { limit: clampIssueLimit(limit, 20, 100) }
    );
    return {
      success: true,
      issues: result.issues.map((item) => toSearchIssue(item, credentials)),
    };
  } catch (error) {
    log.error('[Plane] searchIssues error:', error);
    return {
      success: false,
      error: planeConnectionService.errorMessage(error, 'Unable to search Plane work items.'),
    };
  }
}

export const planeIssueProvider: IssueProvider = {
  type: 'plane',
  capabilities: ISSUE_PROVIDER_CAPABILITIES.plane,
  checkConnection: () => planeConnectionService.checkConnection(),
  listIssues: async (opts) => listIssues(opts.limit ?? 50),
  searchIssues: async (opts) => searchIssues(opts.searchTerm, opts.limit ?? 20),
};
