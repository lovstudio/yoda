import {
  isFullPage,
  type BlockObjectResponse,
  type PageObjectResponse,
  type PartialBlockObjectResponse,
  type RichTextItemResponse,
} from '@notionhq/client';
import { ISSUE_PROVIDER_CAPABILITIES, type IssueListResult } from '@shared/issue-providers';
import type { Issue } from '@shared/tasks';
import { clampIssueLimit, normalizeSearchTerm } from '@main/core/issues/helpers/provider-inputs';
import type { IssueProvider } from '@main/core/issues/issue-provider';
import { log } from '@main/lib/logger';
import { createNotionClient } from './notion-client';
import { notionConnectionService } from './notion-connection-service';

type NotionPageProperty = PageObjectResponse['properties'][string];
const UNTITLED_NOTION_PAGE = 'Untitled Notion page';
const NOTION_PAGE_SIZE = 100;

function richTextPlainText(richText: RichTextItemResponse[] | undefined): string {
  return (richText ?? [])
    .map((item) => item.plain_text)
    .join('')
    .trim();
}

function pageTitle(page: PageObjectResponse): string {
  const title = Object.values(page.properties).find((property) => property.type === 'title');
  return title?.type === 'title'
    ? richTextPlainText(title.title) || UNTITLED_NOTION_PAGE
    : UNTITLED_NOTION_PAGE;
}

function firstRichTextProperty(page: PageObjectResponse): string | undefined {
  for (const property of Object.values(page.properties)) {
    if (property.type !== 'rich_text') continue;
    const value = richTextPlainText(property.rich_text);
    if (value) return value;
  }
  return undefined;
}

function statusLabel(property: NotionPageProperty | undefined): string | undefined {
  if (property?.type === 'status') return property.status?.name;
  if (property?.type === 'select') return property.select?.name;
  return undefined;
}

function firstStatusProperty(page: PageObjectResponse): string | undefined {
  for (const preferred of ['status', 'state', 'stage']) {
    const property = Object.entries(page.properties).find(
      ([name]) => name.toLowerCase() === preferred
    )?.[1];
    const value = statusLabel(property);
    if (value) return value;
  }
  for (const property of Object.values(page.properties)) {
    const value = statusLabel(property);
    if (value) return value;
  }
  return undefined;
}

function toIssue(page: PageObjectResponse): Issue {
  const assignees = Object.values(page.properties)
    .filter((property) => property.type === 'people')
    .flatMap((property) => (property.type === 'people' ? property.people : []))
    .map((person) => ('name' in person ? person.name : undefined))
    .filter((name): name is string => !!name);
  return {
    provider: 'notion',
    identifier: page.id,
    title: pageTitle(page),
    url: page.url,
    description: firstRichTextProperty(page),
    status: firstStatusProperty(page),
    assignees: assignees.length ? assignees : undefined,
    project:
      page.parent.type === 'database_id'
        ? 'Database'
        : page.parent.type === 'data_source_id'
          ? 'Data source'
          : undefined,
    updatedAt: page.last_edited_time,
    fetchedAt: new Date().toISOString(),
  };
}

function isDatabasePage(page: PageObjectResponse): boolean {
  return page.parent.type === 'database_id' || page.parent.type === 'data_source_id';
}

function visibleIssues(pages: PageObjectResponse[]): Issue[] {
  return pages
    .filter(isDatabasePage)
    .filter((page) => pageTitle(page) !== UNTITLED_NOTION_PAGE)
    .map(toIssue);
}

function formatLine(prefix: string, richText: RichTextItemResponse[] | undefined) {
  const text = richTextPlainText(richText);
  return text ? `${prefix} ${text}` : undefined;
}

function blockText(block: BlockObjectResponse | PartialBlockObjectResponse): string | undefined {
  if (!('type' in block)) return undefined;
  switch (block.type) {
    case 'paragraph':
      return richTextPlainText('paragraph' in block ? block.paragraph?.rich_text : undefined);
    case 'heading_1':
      return formatLine('#', 'heading_1' in block ? block.heading_1?.rich_text : undefined);
    case 'heading_2':
      return formatLine('##', 'heading_2' in block ? block.heading_2?.rich_text : undefined);
    case 'heading_3':
      return formatLine('###', 'heading_3' in block ? block.heading_3?.rich_text : undefined);
    case 'bulleted_list_item':
      return formatLine(
        '-',
        'bulleted_list_item' in block ? block.bulleted_list_item?.rich_text : undefined
      );
    case 'numbered_list_item':
      return formatLine(
        '1.',
        'numbered_list_item' in block ? block.numbered_list_item?.rich_text : undefined
      );
    case 'to_do':
      return 'to_do' in block
        ? formatLine(`[${block.to_do?.checked ? 'x' : ' '}]`, block.to_do?.rich_text)
        : undefined;
    case 'quote':
      return formatLine('>', 'quote' in block ? block.quote?.rich_text : undefined);
    case 'code': {
      if (!('code' in block)) return undefined;
      const text = richTextPlainText(block.code?.rich_text);
      return text ? `\`\`\`${block.code?.language ?? ''}\n${text}\n\`\`\`` : undefined;
    }
    default:
      return undefined;
  }
}

async function hydrateIssue(issue: Issue): Promise<Issue> {
  const credentials = await notionConnectionService.getCredentials();
  if (!credentials) return issue;
  const client = createNotionClient(credentials);
  const page = await client.pages.retrieve({ page_id: issue.identifier });
  if (!isFullPage(page)) return issue;

  const blocks: Array<BlockObjectResponse | PartialBlockObjectResponse> = [];
  let startCursor: string | null | undefined;
  do {
    const response = await client.blocks.children.list({
      block_id: page.id,
      page_size: NOTION_PAGE_SIZE,
      ...(startCursor ? { start_cursor: startCursor } : {}),
    });
    blocks.push(...response.results);
    startCursor = response.has_more ? response.next_cursor : null;
  } while (startCursor);

  const body = blocks
    .map(blockText)
    .filter((line): line is string => !!line?.trim())
    .join('\n');
  const mapped = toIssue(page);
  const summary = mapped.description?.trim();
  const description = [summary, body && body !== summary ? body : undefined]
    .filter(Boolean)
    .join('\n\n');
  return { ...issue, ...mapped, description: description || undefined };
}

async function listIssues(limit: number): Promise<IssueListResult> {
  const credentials = await notionConnectionService.getCredentials();
  if (!credentials) {
    return { success: false, error: 'Notion is not configured. Connect Notion in settings.' };
  }
  const sanitizedLimit = clampIssueLimit(limit, 50, 100);
  try {
    const client = createNotionClient(credentials);
    const pages: PageObjectResponse[] = [];
    let startCursor: string | null | undefined;
    do {
      const response = await client.search({
        filter: { property: 'object', value: 'page' },
        sort: { timestamp: 'last_edited_time', direction: 'descending' },
        page_size: NOTION_PAGE_SIZE,
        ...(startCursor ? { start_cursor: startCursor } : {}),
      });
      pages.push(...response.results.filter(isFullPage));
      startCursor = response.has_more ? response.next_cursor : null;
    } while (startCursor && visibleIssues(pages).length < sanitizedLimit);
    return { success: true, issues: visibleIssues(pages).slice(0, sanitizedLimit) };
  } catch (error) {
    return {
      success: false,
      error: notionConnectionService.errorMessage(error, 'Unable to fetch Notion pages.'),
    };
  }
}

async function searchIssues(searchTerm: string, limit: number): Promise<IssueListResult> {
  const term = normalizeSearchTerm(searchTerm);
  if (!term) return { success: true, issues: [] };
  const credentials = await notionConnectionService.getCredentials();
  if (!credentials) {
    return { success: false, error: 'Notion is not configured. Connect Notion in settings.' };
  }
  try {
    const response = await createNotionClient(credentials).search({
      query: term,
      filter: { property: 'object', value: 'page' },
      sort: { timestamp: 'last_edited_time', direction: 'descending' },
      page_size: clampIssueLimit(limit, 20, 100),
    });
    return {
      success: true,
      issues: visibleIssues(response.results.filter(isFullPage)),
    };
  } catch (error) {
    log.error('[Notion] searchIssues error:', error);
    return {
      success: false,
      error: notionConnectionService.errorMessage(error, 'Unable to search Notion pages.'),
    };
  }
}

export const notionIssueProvider: IssueProvider = {
  type: 'notion',
  capabilities: ISSUE_PROVIDER_CAPABILITIES.notion,
  checkConnection: () => notionConnectionService.checkConnection(),
  listIssues: async (opts) => listIssues(opts.limit ?? 50),
  searchIssues: async (opts) => searchIssues(opts.searchTerm, opts.limit ?? 20),
  hydrateIssue,
};
