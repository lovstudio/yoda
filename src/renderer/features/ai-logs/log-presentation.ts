import type { AiInvocationLogRecord, AiLogStatus } from '@shared/ai-logs';

/**
 * Presentation helpers for the AI invocation log. Kept out of the component so
 * the grouping and failure-diagnosis rules stay pure and readable.
 */

/** Coarse bucket answering "what kind of AI work is this". */
export const AI_LOG_CATEGORIES = ['conversation', 'builtin', 'image', 'inspect'] as const;
export type AiLogCategory = (typeof AI_LOG_CATEGORIES)[number];

const CATEGORY_BY_PURPOSE: Record<string, AiLogCategory> = {
  'interactive-session': 'conversation',
  'interactive-turn': 'conversation',
  'logo-generation': 'image',
  'avatar-generation': 'image',
  'app-image-edit': 'image',
  'maas-chat': 'inspect',
  'llm-debug': 'inspect',
};

export function aiLogCategory(record: AiInvocationLogRecord): AiLogCategory {
  return CATEGORY_BY_PURPOSE[record.purpose] ?? 'builtin';
}

/**
 * Metadata rendered as dedicated chips (account, endpoint, Agent) or used only
 * for wiring — never dumped into the raw metadata grid.
 */
const CHIP_METADATA_KEYS = new Set([
  'agent',
  'agentId',
  'authProvider',
  'endpoint',
  'maasEffective',
  'maasPlatformId',
  'sessionLogId',
]);

export function extraAiLogMetadata(record: AiInvocationLogRecord): Array<[string, string]> {
  return Object.entries(record.metadata ?? {})
    .filter(([key]) => !CHIP_METADATA_KEYS.has(key))
    .sort(([left], [right]) => left.localeCompare(right));
}

/** One `interactive-session` row plus the turns that ran inside it. */
export type AiLogGroup = {
  record: AiInvocationLogRecord;
  children: AiInvocationLogRecord[];
};

/**
 * Nests `interactive-turn` rows under the `interactive-session` they belong to.
 * New rows carry `sessionLogId`; older ones are matched by conversation id and
 * the session's own time window, so historical logs still read as a tree.
 */
export function groupAiLogs(records: AiInvocationLogRecord[]): AiLogGroup[] {
  const sessions = new Map<string, AiLogGroup>();
  const sessionsByConversation = new Map<string, AiLogGroup[]>();
  for (const record of records) {
    if (record.purpose !== 'interactive-session') continue;
    const group: AiLogGroup = { record, children: [] };
    sessions.set(record.id, group);
    const conversationId = record.metadata?.conversationId;
    if (!conversationId) continue;
    const siblings = sessionsByConversation.get(conversationId) ?? [];
    siblings.push(group);
    sessionsByConversation.set(conversationId, siblings);
  }

  const groups: AiLogGroup[] = [];
  for (const record of records) {
    if (record.purpose === 'interactive-session') {
      const group = sessions.get(record.id);
      if (group) groups.push(group);
      continue;
    }
    const parent =
      record.purpose === 'interactive-turn'
        ? findSessionGroup(record, sessions, sessionsByConversation)
        : undefined;
    if (parent) parent.children.push(record);
    else groups.push({ record, children: [] });
  }

  for (const group of groups) {
    // Turns read top-down in the order they ran, even though the list itself is newest-first.
    group.children.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  }
  return groups;
}

function findSessionGroup(
  record: AiInvocationLogRecord,
  sessions: Map<string, AiLogGroup>,
  sessionsByConversation: Map<string, AiLogGroup[]>
): AiLogGroup | undefined {
  const sessionLogId = record.metadata?.sessionLogId;
  if (sessionLogId) return sessions.get(sessionLogId);

  const conversationId = record.metadata?.conversationId;
  if (!conversationId) return undefined;
  const candidates = sessionsByConversation.get(conversationId);
  if (!candidates?.length) return undefined;

  const startedAt = Date.parse(record.startedAt);
  if (!Number.isFinite(startedAt)) return undefined;
  let best: AiLogGroup | undefined;
  let bestStart = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const from = Date.parse(candidate.record.startedAt);
    if (!Number.isFinite(from) || from > startedAt) continue;
    const until = candidate.record.finishedAt
      ? Date.parse(candidate.record.finishedAt)
      : Number.POSITIVE_INFINITY;
    if (startedAt > until) continue;
    if (from <= bestStart) continue;
    best = candidate;
    bestStart = from;
  }
  return best;
}

export function filterAiLogGroups(
  groups: AiLogGroup[],
  filter: { category: AiLogCategory | 'all'; query: string }
): AiLogGroup[] {
  const query = filter.query.trim().toLowerCase();
  return groups.filter((group) => {
    if (filter.category !== 'all' && aiLogCategory(group.record) !== filter.category) return false;
    if (!query) return true;
    return (
      matchesQuery(group.record, query) ||
      group.children.some((child) => matchesQuery(child, query))
    );
  });
}

function matchesQuery(record: AiInvocationLogRecord, query: string): boolean {
  const haystack = [
    record.purpose,
    record.runtime,
    record.model,
    record.prompt,
    record.output,
    record.error,
    ...Object.entries(record.metadata ?? {}).map(([key, value]) => `${key}=${value}`),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return haystack.includes(query);
}

export function countAiLogStatuses(
  records: AiInvocationLogRecord[]
): Record<AiLogStatus | 'total', number> {
  const counts = { total: records.length, running: 0, succeeded: 0, failed: 0 };
  for (const record of records) counts[record.status] += 1;
  return counts;
}

/**
 * Why a failed invocation failed, in terms the user can act on. Only patterns we
 * actually emit are classified — an unrecognised error stays unlabeled rather
 * than getting a guessed explanation.
 */
export type AiLogDiagnosis =
  | 'timeoutSilent'
  | 'timeout'
  | 'interrupted'
  | 'sessionExited'
  | 'missingCli'
  | 'upstream';

export function diagnoseAiLogFailure(record: AiInvocationLogRecord): AiLogDiagnosis | null {
  if (record.status !== 'failed') return null;
  const error = record.error ?? '';
  if (!error) return null;
  if (/without printing anything/i.test(error)) return 'timeoutSilent';
  if (/timed out/i.test(error)) return 'timeout';
  if (/the app quit before/i.test(error)) return 'interrupted';
  if (/session exited before/i.test(error)) return 'sessionExited';
  if (/ENOENT|command not found|is not installed/i.test(error)) return 'missingCli';
  if (
    /API Error|HTTP [45]\d\d|status(?: code)? [45]\d\d|rate limit|unauthorized|forbidden|invalid api key/i.test(
      error
    )
  ) {
    return 'upstream';
  }
  return null;
}

/** First meaningful line of a record, for the collapsed row preview. */
export function aiLogPreview(record: AiInvocationLogRecord): string | null {
  const source = record.status === 'failed' ? (record.error ?? record.prompt) : record.prompt;
  const text = (source ?? record.output ?? '').trim();
  if (!text) return null;
  const firstLine = text
    .split('\n')
    .find((line) => line.trim().length > 0)
    ?.trim();
  return firstLine ? firstLine.slice(0, 240) : null;
}
