import type { SessionSummarySnapshot } from '@shared/conversations';
import { sessionSummarySnapshotUpdatedChannel } from '@shared/events/sessionSummaryEvents';
import type { TaskNamingContextSnapshot, TaskNamingStatus } from '@shared/task-naming';
import { estimateTokens } from '@main/core/tasks/name-generation/task-naming-service';
import { events } from '@main/lib/events';
import type { ResolvedSummaryRuntime } from './generateSessionSummary';
import type { SummaryDraft } from './session-summary-prompt';

/**
 * In-memory debug snapshots of whole-session summary generation, mirroring
 * `conversationNamingSnapshots` in generateConversationTitle.ts. Only the
 * `global` scope is tracked — `recent` regenerates every turn and would spam
 * the channel with snapshots nobody inspects.
 */
const sessionSummarySnapshots = new Map<string, SessionSummarySnapshot>();

export type SessionSummarySnapshotInput = {
  conversationId: string;
  projectId: string;
  taskId: string;
  status: TaskNamingStatus;
  runtime: ResolvedSummaryRuntime | null;
  /** Resolved prompt draft; null when prompt building itself failed. */
  draft: SummaryDraft | null;
  generatedSummary?: string;
  error?: string;
};

export async function getSessionSummarySnapshot(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<SessionSummarySnapshot | null> {
  const snapshot = sessionSummarySnapshots.get(conversationId);
  if (!snapshot || snapshot.projectId !== projectId || snapshot.taskId !== taskId) return null;
  return snapshot;
}

export function createSessionSummarySnapshot(
  input: SessionSummarySnapshotInput
): SessionSummarySnapshot {
  const now = new Date().toISOString();
  const existing = sessionSummarySnapshots.get(input.conversationId);
  const createdAt = input.status === 'generating' ? now : (existing?.createdAt ?? now);
  const systemPrompt = input.runtime?.systemPrompt.trim() || undefined;
  return {
    conversationId: input.conversationId,
    projectId: input.projectId,
    taskId: input.taskId,
    status: input.status,
    model: input.runtime?.model ?? null,
    runtimeId: input.runtime?.runtimeId ?? null,
    runtimeName: input.runtime?.runtimeName ?? null,
    language: input.runtime?.language ?? null,
    context: input.draft ? buildSummaryContextSnapshot(input) : null,
    systemPrompt,
    systemPromptEstimatedTokens: systemPrompt ? estimateTokens(systemPrompt) : undefined,
    prompt: input.draft?.prompt,
    promptChars: input.draft?.prompt.length,
    promptEstimatedTokens: input.draft ? estimateTokens(input.draft.prompt) : undefined,
    generatedSummary: input.generatedSummary,
    error: input.error,
    createdAt,
    updatedAt: now,
  };
}

export function saveSessionSummarySnapshot(
  input: SessionSummarySnapshotInput
): SessionSummarySnapshot {
  const snapshot = createSessionSummarySnapshot(input);
  sessionSummarySnapshots.set(input.conversationId, snapshot);
  events.emit(sessionSummarySnapshotUpdatedChannel, snapshot);
  return snapshot;
}

/**
 * Reuses the naming context-snapshot shape so the renderer renders summary
 * context sources with the exact same component as naming.
 */
function buildSummaryContextSnapshot(
  input: SessionSummarySnapshotInput
): TaskNamingContextSnapshot {
  const draft = input.draft;
  const sources = [
    ...(draft?.previousSummary
      ? [
          {
            id: 'previous-summary',
            label: 'Existing summary',
            content: draft.previousSummary,
            estimatedTokens: estimateTokens(draft.previousSummary),
          },
        ]
      : []),
    ...(draft?.projectLine
      ? [
          {
            id: 'project',
            label: 'Project',
            content: draft.projectLine,
            estimatedTokens: estimateTokens(draft.projectLine),
          },
        ]
      : []),
    ...(draft?.transcript
      ? [
          {
            id: 'prompt',
            label: draft.previousSummary ? 'New session transcript' : 'Session transcript',
            content: draft.transcript,
            estimatedTokens: estimateTokens(draft.transcript),
            truncated: draft.transcriptTruncated,
          },
        ]
      : []),
  ];
  return {
    version: 1,
    taskId: input.taskId,
    projectId: input.projectId,
    createdAt: new Date().toISOString(),
    language: (input.runtime?.language ?? 'app') as TaskNamingContextSnapshot['language'],
    model: input.runtime?.model ?? '',
    estimatedTokens: sources.reduce((sum, source) => sum + source.estimatedTokens, 0),
    estimatedCharacters: sources.reduce((sum, source) => sum + source.content.length, 0),
    sourceCount: sources.length,
    sources,
  };
}
