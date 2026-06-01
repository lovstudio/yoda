import { APP_NAME_LOWER } from './app-identity';

export type ParsedDeepLink = {
  projectId?: string;
  taskId?: string;
  conversationId?: string;
  promptId?: string;
  promptIndex?: number;
};

export type DeepLinkTarget = {
  id: string;
  rawUrl: string;
  projectId: string;
  taskId: string;
  conversationId?: string;
  promptId?: string;
  promptIndex?: number;
};

export function isYodaDeepLinkUrl(rawUrl: string, scheme = APP_NAME_LOWER): boolean {
  try {
    return new URL(rawUrl).protocol === `${scheme}:`;
  } catch {
    return false;
  }
}

export function buildSessionDeepLink(
  args: { conversationId: string; promptId?: string; promptIndex?: number },
  scheme = APP_NAME_LOWER
): string {
  const url = new URL(`${scheme}://session/${encodeURIComponent(args.conversationId)}`);
  if (args.promptId) url.searchParams.set('promptId', args.promptId);
  if (args.promptIndex !== undefined) url.searchParams.set('promptIndex', String(args.promptIndex));
  return url.toString();
}

export function parseYodaDeepLink(rawUrl: string, scheme = APP_NAME_LOWER): ParsedDeepLink | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== `${scheme}:`) return null;

  const parts = pathParts(url);
  const route = url.hostname || parts.shift();
  const queryTarget = queryParams(url.searchParams);

  if (!route) return Object.keys(queryTarget).length > 0 ? queryTarget : null;

  switch (route) {
    case 'open':
      return Object.keys(queryTarget).length > 0 ? queryTarget : null;
    case 'conversation':
    case 'session':
      return compactTarget({
        ...queryTarget,
        conversationId: parts[0] ?? queryTarget.conversationId,
        ...promptFromPath(parts, 1),
      });
    case 'task':
      return compactTarget({
        ...queryTarget,
        projectId: parts[0] ?? queryTarget.projectId,
        taskId: parts[1] ?? queryTarget.taskId,
        ...conversationAndPromptFromPath(parts, 2),
      });
    default:
      return compactTarget({
        ...queryTarget,
        conversationId: route,
        ...promptFromPath(parts, 0),
      });
  }
}

function queryParams(searchParams: URLSearchParams): ParsedDeepLink {
  return compactTarget({
    projectId: firstParam(searchParams, 'projectId', 'project'),
    taskId: firstParam(searchParams, 'taskId', 'task'),
    conversationId: firstParam(
      searchParams,
      'conversationId',
      'sessionId',
      'conversation',
      'session'
    ),
    promptId: firstParam(searchParams, 'promptId', 'prompt'),
    promptIndex: parsePromptIndex(firstParam(searchParams, 'promptIndex', 'promptNumber')),
  });
}

function conversationAndPromptFromPath(parts: string[], start: number): ParsedDeepLink {
  if (parts[start] !== 'session' && parts[start] !== 'conversation')
    return promptFromPath(parts, start);
  return {
    conversationId: parts[start + 1],
    ...promptFromPath(parts, start + 2),
  };
}

function promptFromPath(parts: string[], start: number): ParsedDeepLink {
  if (parts[start] !== 'prompt') return {};
  return compactTarget({ promptId: parts[start + 1] });
}

function pathParts(url: URL): string[] {
  return url.pathname
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => decodeURIComponent(part));
}

function firstParam(searchParams: URLSearchParams, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = searchParams.get(name)?.trim();
    if (value) return value;
  }
  return undefined;
}

function parsePromptIndex(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function compactTarget(target: ParsedDeepLink): ParsedDeepLink {
  return Object.fromEntries(
    Object.entries(target).filter(([, value]) => value !== undefined && value !== '')
  ) as ParsedDeepLink;
}
