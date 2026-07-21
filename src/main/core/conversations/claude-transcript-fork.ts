import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { resolveClaudeTranscriptPathFromConfigDir } from '@main/core/session-title/claude-title-source';

type ClaudeTranscriptRow = Record<string, unknown>;

type BuildForkedClaudeTranscriptParams = {
  raw: string;
  sourceSessionId: string;
  targetSessionId: string;
  targetMessageId: string;
  createUuid?: () => string;
  now?: () => Date;
};

export type BuildForkedClaudeTranscriptResult = {
  raw: string;
  copiedRowCount: number;
  leafUuid: string;
};

export type ForkClaudeTranscriptParams = {
  cwd?: string;
  claudeConfigDir?: string;
  sourceSessionId: string;
  targetSessionId: string;
  targetMessageId: string;
  /** Test/repair escape hatch. Production callers should use the canonical cwd path. */
  sourcePath?: string;
  /** Test/repair escape hatch. Production callers should use the canonical cwd path. */
  targetPath?: string;
};

export type ForkClaudeTranscriptResult = {
  transcriptPath: string;
  copiedRowCount: number;
  leafUuid: string;
};

export type DeleteClaudeTranscriptParams = {
  cwd?: string;
  claudeConfigDir?: string;
  sessionId: string;
  /** Test/repair escape hatch. Production callers should use the canonical cwd path. */
  targetPath?: string;
};

const TRANSCRIPT_TYPES = new Set(['user', 'assistant', 'attachment', 'system', 'progress']);
const WRITABLE_TRANSCRIPT_TYPES = new Set(['user', 'assistant', 'attachment', 'system']);
const SOURCE_STATE_FIELDS = ['teamName', 'agentName', 'slug', 'sourceToolAssistantUUID'] as const;

/**
 * Returns the provider-native completion marker for every completed real-user
 * turn. A checkpoint is the final main-chain `system/turn_duration` between
 * that prompt and the next real prompt. This keeps an in-flight latest turn
 * unavailable while still including completed background-notification work.
 */
export function getClaudeCompletedTurnTargets(raw: string): Map<string, string> {
  const rows = selectClaudeCurrentBranchRows(
    parseForkTranscript(raw, null).transcript.filter((row) => !row.isSidechain)
  );
  const promptIndexes = rows.flatMap((row, index) =>
    isClaudeRealUserPromptRow(row) ? [index] : []
  );
  const rowsByUuid = indexRowsByUuid(rows);
  const targets = new Map<string, string>();

  for (let promptOffset = 0; promptOffset < promptIndexes.length; promptOffset += 1) {
    const promptIndex = promptIndexes[promptOffset];
    const promptId = stringValue(rows[promptIndex].uuid);
    if (!promptId) continue;

    const nextPromptIndex = promptIndexes[promptOffset + 1] ?? rows.length;
    for (let index = nextPromptIndex - 1; index > promptIndex; index -= 1) {
      const candidate = rows[index];
      const candidateId = stringValue(candidate.uuid);
      if (!candidateId || !isTurnDurationRow(candidate)) continue;
      if (!isDescendantOf(candidate, promptId, rowsByUuid)) continue;
      targets.set(promptId, candidateId);
      break;
    }
  }

  return targets;
}

/**
 * Returns the UUIDs on Claude's currently selected transcript branch.
 *
 * Claude keeps rewound turns in the append-only JSONL file. A later prompt is
 * linked back to the selected checkpoint through `parentUuid`, so file order
 * alone is not conversation order after an Esc Esc rewind.
 */
export function getClaudeCurrentBranchMessageIds(raw: string): ReadonlySet<string> {
  return new Set(
    selectClaudeCurrentBranchRows(
      parseForkTranscript(raw, null).transcript.filter((row) => !row.isSidechain)
    ).flatMap((row) => {
      const id = stringValue(row.uuid);
      return id ? [id] : [];
    })
  );
}

/**
 * Claude records tool results and runtime notifications as `user` rows too.
 * This predicate identifies only a real user-authored prompt with a native
 * UUID, matching the context-history surface's restore boundary semantics.
 */
export function isClaudeRealUserPromptRow(row: ClaudeTranscriptRow): boolean {
  if (row.type !== 'user') return false;
  if (Boolean(row.isSidechain) || row.isMeta === true || row.isCompactSummary === true) {
    return false;
  }
  if (!stringValue(row.uuid)) return false;
  const message = objectValue(row.message);
  if (message?.role !== 'user') return false;
  return extractUserPromptText(message.content) !== null;
}

/**
 * Builds a fresh Claude JSONL transcript through one completed-turn marker.
 * The transform mirrors the Agent SDK fork implementation: only transcript
 * message types participate, sidechains are dropped, progress rows are used
 * solely to resolve ancestry, and source UUID/session state is rewritten.
 */
export function buildForkedClaudeTranscript({
  raw,
  sourceSessionId,
  targetSessionId,
  targetMessageId,
  createUuid = randomUUID,
  now = () => new Date(),
}: BuildForkedClaudeTranscriptParams): BuildForkedClaudeTranscriptResult {
  if (!sourceSessionId.trim()) throw new Error('Source Claude session id is required');
  if (!targetSessionId.trim()) throw new Error('Target Claude session id is required');
  if (!targetMessageId.trim()) throw new Error('Target Claude message id is required');

  const { transcript: parsedTranscript, contentReplacements } = parseForkTranscript(
    raw,
    sourceSessionId
  );
  let transcript = parsedTranscript.filter((row) => !row.isSidechain);
  if (transcript.length === 0) {
    throw new Error(`Claude session ${sourceSessionId} has no messages to fork`);
  }

  const completedTargets = getClaudeCompletedTurnTargets(raw);
  if (![...completedTargets.values()].includes(targetMessageId)) {
    throw new Error(`Claude restore target is not a completed user turn: ${targetMessageId}`);
  }

  if (!transcript.some((row) => row.uuid === targetMessageId)) {
    throw new Error(`Claude restore target not found: ${targetMessageId}`);
  }
  transcript = selectClaudeBranchThroughTarget(transcript, targetMessageId);

  // The SDK assigns UUIDs before filtering progress rows because progress
  // entries can still be links in the parentUuid graph.
  const uuidMap = new Map<string, string>();
  const generatedUuids = new Set<string>();
  for (const row of transcript) {
    const sourceUuid = row.uuid as string;
    const targetUuid = createUuid();
    if (!targetUuid || generatedUuids.has(targetUuid)) {
      throw new Error('Claude transcript UUID generator returned an empty or duplicate UUID');
    }
    generatedUuids.add(targetUuid);
    uuidMap.set(sourceUuid, targetUuid);
  }

  const writable = transcript.filter(
    (row) => typeof row.type === 'string' && WRITABLE_TRANSCRIPT_TYPES.has(row.type)
  );
  if (writable.length === 0) {
    throw new Error(`Claude session ${sourceSessionId} has no messages to fork`);
  }

  const rowsByUuid = indexRowsByUuid(transcript);
  const timestamp = now().toISOString();
  const rewrittenRows = writable.map((row, index) => {
    const sourceUuid = row.uuid as string;
    const rewritten: ClaudeTranscriptRow = {
      ...row,
      uuid: requireMappedUuid(uuidMap, sourceUuid),
      parentUuid: resolveWritableParent(row.parentUuid, rowsByUuid, uuidMap),
      logicalParentUuid: remapLogicalParent(row.logicalParentUuid, uuidMap),
      sessionId: targetSessionId,
      timestamp:
        index === writable.length - 1
          ? timestamp
          : Object.prototype.hasOwnProperty.call(row, 'timestamp')
            ? row.timestamp
            : timestamp,
      isSidechain: false,
      forkedFrom: {
        sessionId: sourceSessionId,
        messageUuid: sourceUuid,
      },
    };
    for (const field of SOURCE_STATE_FIELDS) delete rewritten[field];
    return rewritten;
  });

  const outputRows = [...rewrittenRows];
  if (contentReplacements.length > 0) {
    outputRows.push({
      type: 'content-replacement',
      sessionId: targetSessionId,
      replacements: contentReplacements,
      uuid: createUniqueUuid(createUuid, generatedUuids),
      timestamp,
    });
  }

  return {
    raw: `${outputRows.map((row) => JSON.stringify(row)).join('\n')}\n`,
    copiedRowCount: rewrittenRows.length,
    leafUuid: rewrittenRows.at(-1)?.uuid as string,
  };
}

/**
 * Copies one completed Claude turn into a new session transcript. The target
 * is created exclusively, so neither the source nor an existing destination
 * can be overwritten.
 */
export async function forkClaudeTranscript({
  cwd,
  claudeConfigDir,
  sourceSessionId,
  targetSessionId,
  targetMessageId,
  sourcePath,
  targetPath,
}: ForkClaudeTranscriptParams): Promise<ForkClaudeTranscriptResult> {
  if (sourceSessionId === targetSessionId) {
    throw new Error('Source and target Claude session ids must differ');
  }
  const resolvedSourcePath = resolveTranscriptPath({
    cwd,
    claudeConfigDir,
    sessionId: sourceSessionId,
    explicitPath: sourcePath,
    kind: 'source',
  });
  const resolvedTargetPath = resolveTranscriptPath({
    cwd,
    claudeConfigDir,
    sessionId: targetSessionId,
    explicitPath: targetPath,
    kind: 'target',
  });
  if (resolve(resolvedSourcePath) === resolve(resolvedTargetPath)) {
    throw new Error('Source and target Claude transcript paths must differ');
  }

  const raw = await readFile(resolvedSourcePath, 'utf8');
  const forked = buildForkedClaudeTranscript({
    raw,
    sourceSessionId,
    targetSessionId,
    targetMessageId,
  });
  await mkdir(dirname(resolvedTargetPath), { recursive: true });
  await writeFile(resolvedTargetPath, forked.raw, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  return {
    transcriptPath: resolvedTargetPath,
    copiedRowCount: forked.copiedRowCount,
    leafUuid: forked.leafUuid,
  };
}

/** Removes a fork transcript during failure compensation; repeated calls are safe. */
export async function deleteClaudeTranscript({
  cwd,
  claudeConfigDir,
  sessionId,
  targetPath,
}: DeleteClaudeTranscriptParams): Promise<void> {
  const transcriptPath = resolveTranscriptPath({
    cwd,
    claudeConfigDir,
    sessionId,
    explicitPath: targetPath,
    kind: 'target',
  });
  await rm(transcriptPath, { force: true });
}

function resolveTranscriptPath({
  cwd,
  claudeConfigDir,
  sessionId,
  explicitPath,
  kind,
}: {
  cwd?: string;
  claudeConfigDir?: string;
  sessionId: string;
  explicitPath?: string;
  kind: 'source' | 'target';
}): string {
  if (explicitPath) return explicitPath;
  if (!cwd) throw new Error(`Claude ${kind} transcript requires cwd or an explicit path`);
  if (!claudeConfigDir) {
    throw new Error(`Claude ${kind} transcript requires a configured state directory`);
  }
  return resolveClaudeTranscriptPathFromConfigDir(cwd, sessionId, claudeConfigDir);
}

/** Mirrors the Agent SDK's `_parse_fork_transcript` partitioning. */
function parseForkTranscript(
  raw: string,
  sourceSessionId: string | null
): { transcript: ClaudeTranscriptRow[]; contentReplacements: unknown[] } {
  const transcript: ClaudeTranscriptRow[] = [];
  const contentReplacements: unknown[] = [];

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const row = parseRow(line);
    if (!row) continue;
    if (
      typeof row.type === 'string' &&
      TRANSCRIPT_TYPES.has(row.type) &&
      typeof row.uuid === 'string'
    ) {
      transcript.push(row);
      continue;
    }
    if (
      sourceSessionId !== null &&
      row.type === 'content-replacement' &&
      row.sessionId === sourceSessionId &&
      Array.isArray(row.replacements)
    ) {
      contentReplacements.push(...row.replacements);
    }
  }

  return { transcript, contentReplacements };
}

function parseRow(line: string): ClaudeTranscriptRow | null {
  try {
    return objectValue(JSON.parse(line));
  } catch {
    // Claude may be appending the final line while the context panel reads it.
    return null;
  }
}

function indexRowsByUuid(rows: ClaudeTranscriptRow[]): Map<string, ClaudeTranscriptRow> {
  const byUuid = new Map<string, ClaudeTranscriptRow>();
  for (const row of rows) {
    if (typeof row.uuid === 'string') byUuid.set(row.uuid, row);
  }
  return byUuid;
}

function selectClaudeCurrentBranchRows(rows: ClaudeTranscriptRow[]): ClaudeTranscriptRow[] {
  const latestPrompt = findLastRow(rows, isClaudeRealUserPromptRow);
  const latestPromptId = stringValue(latestPrompt?.uuid);
  if (!latestPromptId) return rows;

  const rowsByUuid = indexRowsByUuid(rows);
  const leaf = findLastRow(rows, (row) => {
    const rowId = stringValue(row.uuid);
    return rowId === latestPromptId || isDescendantOf(row, latestPromptId, rowsByUuid);
  });
  const leafId = stringValue(leaf?.uuid) ?? latestPromptId;
  return selectClaudeBranchThroughTarget(rows, leafId);
}

function selectClaudeBranchThroughTarget(
  rows: ClaudeTranscriptRow[],
  targetMessageId: string
): ClaudeTranscriptRow[] {
  const rowsByUuid = indexRowsByUuid(rows);
  const branchIds = new Set<string>();
  let cursor: string | null = targetMessageId;

  while (cursor && !branchIds.has(cursor)) {
    const row = rowsByUuid.get(cursor);
    if (!row) break;
    branchIds.add(cursor);
    cursor = stringValue(row.parentUuid);
  }

  return rows.filter((row) => {
    const id = stringValue(row.uuid);
    return id !== null && branchIds.has(id);
  });
}

function findLastRow(
  rows: readonly ClaudeTranscriptRow[],
  predicate: (row: ClaudeTranscriptRow) => boolean
): ClaudeTranscriptRow | undefined {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row && predicate(row)) return row;
  }
  return undefined;
}

function isDescendantOf(
  row: ClaudeTranscriptRow,
  ancestorUuid: string,
  rowsByUuid: Map<string, ClaudeTranscriptRow>
): boolean {
  const visited = new Set<string>();
  let parentUuid = stringValue(row.parentUuid);
  while (parentUuid) {
    if (parentUuid === ancestorUuid) return true;
    if (visited.has(parentUuid)) return false;
    visited.add(parentUuid);
    const parent = rowsByUuid.get(parentUuid);
    if (!parent) return false;
    parentUuid = stringValue(parent.parentUuid);
  }
  return false;
}

function isTurnDurationRow(row: ClaudeTranscriptRow): boolean {
  return row.type === 'system' && row.subtype === 'turn_duration';
}

function resolveWritableParent(
  value: unknown,
  rowsByUuid: Map<string, ClaudeTranscriptRow>,
  uuidMap: Map<string, string>
): string | null {
  let parentId = typeof value === 'string' ? value : null;
  const visited = new Set<string>();
  while (parentId) {
    if (visited.has(parentId)) return null;
    visited.add(parentId);
    const parent = rowsByUuid.get(parentId);
    if (!parent) return null;
    if (parent.type !== 'progress') return uuidMap.get(parentId) ?? null;
    parentId = typeof parent.parentUuid === 'string' ? parent.parentUuid : null;
  }
  return null;
}

function remapLogicalParent(value: unknown, uuidMap: Map<string, string>): unknown {
  if (!value) return value ?? null;
  return typeof value === 'string' ? (uuidMap.get(value) ?? null) : null;
}

function requireMappedUuid(map: Map<string, string>, sourceUuid: string): string {
  const mapped = map.get(sourceUuid);
  if (!mapped) throw new Error(`Claude transcript UUID is not mapped: ${sourceUuid}`);
  return mapped;
}

function createUniqueUuid(createUuid: () => string, generated: Set<string>): string {
  const value = createUuid();
  if (!value || generated.has(value)) {
    throw new Error('Claude transcript UUID generator returned an empty or duplicate UUID');
  }
  generated.add(value);
  return value;
}

function extractUserPromptText(content: unknown): string | null {
  if (typeof content === 'string') return cleanUserPromptText(content);
  if (!Array.isArray(content)) return null;

  const parts: string[] = [];
  for (const item of content) {
    const block = objectValue(item);
    if (block?.type !== 'text' || typeof block.text !== 'string') continue;
    const text = cleanUserPromptText(block.text);
    if (text) parts.push(text);
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

function cleanUserPromptText(text: string): string | null {
  const cleaned = text
    .replace(/<command-message>[\s\S]*?<\/command-message>\s*/g, '')
    .replace(/<command-name>[\s\S]*?<\/command-name>\s*/g, '')
    .replace(/<command-args>[\s\S]*?<\/command-args>\s*/g, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>\s*/g, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, '')
    .replace(/<task-notification>[\s\S]*?<\/task-notification>\s*/g, '')
    .trim();
  return cleaned || null;
}

function objectValue(value: unknown): ClaudeTranscriptRow | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as ClaudeTranscriptRow)
    : null;
}

function stringValue(value: unknown): string | null {
  const string = typeof value === 'string' ? value.trim() : '';
  return string || null;
}
