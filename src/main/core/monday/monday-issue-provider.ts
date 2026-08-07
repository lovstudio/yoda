import { ISSUE_PROVIDER_CAPABILITIES, type IssueListResult } from '@shared/issue-providers';
import type { Issue } from '@shared/tasks';
import { clampIssueLimit, normalizeSearchTerm } from '@main/core/issues/helpers/provider-inputs';
import type { IssueProvider } from '@main/core/issues/issue-provider';
import { log } from '@main/lib/logger';
import {
  createMondayClient,
  queryMondayBoards,
  type MondayBoard,
  type MondayItem,
} from './monday-client';
import { mondayConnectionService } from './monday-connection-service';

function toIssue(item: MondayItem, board: MondayBoard): Issue {
  const description = item.column_values.find(
    (column) => column.type === 'long_text' || column.type === 'text'
  )?.text;
  return {
    provider: 'monday',
    identifier: item.id,
    title: item.name,
    url: `${board.url}/pulses/${item.id}`,
    description: description || undefined,
    project: board.name,
    updatedAt: item.updated_at ?? undefined,
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchIssues(limit: number, searchTerm?: string): Promise<IssueListResult> {
  const credentials = await mondayConnectionService.getCredentials();
  if (!credentials) {
    return {
      success: false,
      error: 'Monday.com is not configured. Connect Monday.com in settings.',
    };
  }

  const sanitizedLimit = clampIssueLimit(limit, searchTerm ? 20 : 50, 200);
  try {
    const boards = await queryMondayBoards(
      createMondayClient(credentials),
      sanitizedLimit,
      searchTerm
    );
    const issues = boards.flatMap((board) =>
      board.items_page.items.map((item) => toIssue(item, board))
    );
    issues.sort(
      (a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
    );
    return { success: true, issues: issues.slice(0, sanitizedLimit) };
  } catch (error) {
    log.error('[Monday] fetchIssues error:', error);
    return {
      success: false,
      error: mondayConnectionService.errorMessage(error, 'Unable to fetch Monday.com items.'),
    };
  }
}

export const mondayIssueProvider: IssueProvider = {
  type: 'monday',
  capabilities: ISSUE_PROVIDER_CAPABILITIES.monday,
  checkConnection: () => mondayConnectionService.checkConnection(),
  listIssues: async (opts) => fetchIssues(opts.limit ?? 50),
  searchIssues: async (opts) => {
    const term = normalizeSearchTerm(opts.searchTerm);
    return term ? fetchIssues(opts.limit ?? 20, term) : { success: true, issues: [] };
  },
};
