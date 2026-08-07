import { ISSUE_PROVIDER_CAPABILITIES, type IssueListResult } from '@shared/issue-providers';
import type { Issue } from '@shared/tasks';
import { clampIssueLimit, normalizeSearchTerm } from '@main/core/issues/helpers/provider-inputs';
import type { IssueProvider } from '@main/core/issues/issue-provider';
import { log } from '@main/lib/logger';
import { createTrelloClient, type TrelloClient } from './trello-client';
import { trelloConnectionService } from './trello-connection-service';

type TrelloBoard = {
  id: string;
  name: string;
  closed?: boolean;
  dateLastActivity?: string | Date;
};

type TrelloCard = {
  id: string;
  shortLink?: string;
  name?: string;
  desc?: string;
  url?: string;
  dateLastActivity?: string | Date;
  board?: { name?: string };
};

function formatDate(value: string | Date | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function toIssue(card: TrelloCard, boardName = card.board?.name): Issue {
  return {
    provider: 'trello',
    identifier: card.shortLink ?? card.id,
    title: card.name ?? '',
    url: card.url ?? '',
    description: card.desc || undefined,
    project: boardName,
    updatedAt: formatDate(card.dateLastActivity),
    fetchedAt: new Date().toISOString(),
  };
}

async function resolveBoards(client: TrelloClient): Promise<TrelloBoard[]> {
  const [memberBoards, organizations] = await Promise.all([
    client.members.getMemberBoards({
      id: 'me',
      fields: 'name,closed,dateLastActivity',
      filter: 'open',
    }),
    client.members.getMemberOrganizations({ id: 'me', fields: ['id'], filter: 'members' }),
  ]);
  const organizationBoards = await Promise.all(
    organizations.map((organization) =>
      client.organizations.getOrganizationBoards({
        id: organization.id,
        fields: 'name,closed,dateLastActivity',
        filter: 'open',
      })
    )
  );
  const unique = new Map<string, TrelloBoard>();
  for (const board of [...memberBoards, ...organizationBoards.flat()] as TrelloBoard[]) {
    if (!board.closed && !unique.has(board.id)) unique.set(board.id, board);
  }
  return [...unique.values()]
    .sort(
      (a, b) =>
        new Date(b.dateLastActivity ?? 0).getTime() - new Date(a.dateLastActivity ?? 0).getTime()
    )
    .slice(0, 20);
}

async function listIssues(limit: number): Promise<IssueListResult> {
  const credentials = await trelloConnectionService.getCredentials();
  if (!credentials) {
    return { success: false, error: 'Trello is not configured. Connect Trello in settings.' };
  }
  const sanitizedLimit = clampIssueLimit(limit, 50, 200);
  try {
    const client = createTrelloClient(credentials);
    const boards = await resolveBoards(client);
    const cards = await Promise.all(
      boards.map(async (board) => {
        const boardCards = await client.boards.getBoardCardsByFilter({
          id: board.id,
          filter: 'open',
        });
        return (boardCards as TrelloCard[]).map((card) => toIssue(card, board.name));
      })
    );
    const issues = cards
      .flat()
      .sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime());
    return { success: true, issues: issues.slice(0, sanitizedLimit) };
  } catch (error) {
    return {
      success: false,
      error: trelloConnectionService.errorMessage(error, 'Unable to fetch Trello cards.'),
    };
  }
}

async function searchIssues(searchTerm: string, limit: number): Promise<IssueListResult> {
  const term = normalizeSearchTerm(searchTerm);
  if (!term) return { success: true, issues: [] };
  const credentials = await trelloConnectionService.getCredentials();
  if (!credentials) {
    return { success: false, error: 'Trello is not configured. Connect Trello in settings.' };
  }
  try {
    const client = createTrelloClient(credentials);
    const boards = await resolveBoards(client);
    if (!boards.length) return { success: true, issues: [] };
    const result = await client.search.search({
      query: term,
      idBoards: boards.map((board) => board.id).join(','),
      modelTypes: 'cards',
      cardFields: 'name,desc,url,shortLink,dateLastActivity',
      cardsLimit: clampIssueLimit(limit, 20, 200),
      cardBoard: true,
      boardFields: ['name'],
      partial: true,
    });
    return {
      success: true,
      issues: ((result.cards ?? []) as TrelloCard[]).map((card) => toIssue(card)),
    };
  } catch (error) {
    log.error('[Trello] searchIssues error:', error);
    return {
      success: false,
      error: trelloConnectionService.errorMessage(error, 'Unable to search Trello cards.'),
    };
  }
}

export const trelloIssueProvider: IssueProvider = {
  type: 'trello',
  capabilities: ISSUE_PROVIDER_CAPABILITIES.trello,
  checkConnection: () => trelloConnectionService.checkConnection(),
  listIssues: async (opts) => listIssues(opts.limit ?? 50),
  searchIssues: async (opts) => searchIssues(opts.searchTerm, opts.limit ?? 20),
};
