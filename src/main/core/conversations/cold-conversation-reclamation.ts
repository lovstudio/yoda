import { normalize } from 'node:path';
import { resolveRuntimeStatusMonitor } from '@shared/runtime-status-monitor';
import { resolveClaudeTranscriptPath } from '@main/core/session-title/claude-title-source';
import {
  readCodexThreadRolloutPaths,
  resolveCodexStatePath,
} from '@main/core/session-title/codex-title-source';
import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import { log } from '@main/lib/logger';
import { readClaudeColdTurnVerdictFile } from './claude-cold-turn-verdict';
import { getClaudeSessionActivity } from './claude-session-activity-source';
import { findClaudeTranscriptPathBySessionId } from './claude-transcript-locator';
import { readCodexTurnVerdictFile } from './codex-run-state-source';
import { parseConversationSessionSource } from './conversation-session-source';

export const COLD_CONVERSATION_STATUS_CONCURRENCY = 4;

export type ColdConversationReclamationStatus = 'working' | 'awaiting-input' | 'idle' | 'error';

export type ColdConversationReclamationCandidate = {
  sessionId: string;
  projectId: string;
  taskId: string;
  conversationId: string;
  runtimeId: string | null;
  cwd: string;
  title: string | null;
  createdAt: string | null;
  config: string | null;
  processPid?: number;
  markerCreatedAtMs?: number;
};

/**
 * Read provider-owned durable state without mounting a task, attaching a PTY,
 * or starting an Agent process. Missing, unsupported, or mismatched evidence
 * returns no verdict so conversation reclamation fails closed.
 */
export async function resolveColdConversationReclamationStatuses(
  candidates: ColdConversationReclamationCandidate[]
): Promise<Map<string, ColdConversationReclamationStatus>> {
  const statuses = new Map<string, ColdConversationReclamationStatus>();
  const monitorByRuntime = new Map<
    'claude' | 'codex',
    Promise<ReturnType<typeof resolveRuntimeStatusMonitor>>
  >();
  const getMonitor = (runtimeId: 'claude' | 'codex') => {
    let monitor = monitorByRuntime.get(runtimeId);
    if (!monitor) {
      monitor = runtimeOverrideSettings
        .getItem(runtimeId)
        .then((config) => resolveRuntimeStatusMonitor(runtimeId, config?.statusMonitor));
      monitorByRuntime.set(runtimeId, monitor);
    }
    return monitor;
  };
  const codexRolloutPathBySessionId = await resolveBoundCodexRolloutPaths(
    candidates,
    getMonitor
  ).catch((error) => {
    log.warn('Cold Codex rollout bindings could not be loaded', { error: String(error) });
    return new Map<string, string>();
  });
  let nextIndex = 0;
  const resolveNext = async (): Promise<void> => {
    while (nextIndex < candidates.length) {
      const candidate = candidates[nextIndex++];
      try {
        if (candidate.runtimeId !== 'claude' && candidate.runtimeId !== 'codex') continue;
        const status = await resolveColdConversationReclamationStatus(
          candidate,
          await getMonitor(candidate.runtimeId),
          codexRolloutPathBySessionId
        );
        if (status) statuses.set(candidate.sessionId, status);
      } catch (error) {
        // A single corrupt/missing provider artifact must protect that owner,
        // not prevent unrelated orphan sessions from being inspected.
        log.warn('Cold conversation status could not be verified', {
          conversationId: candidate.conversationId,
          runtimeId: candidate.runtimeId,
          error: String(error),
        });
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(COLD_CONVERSATION_STATUS_CONCURRENCY, candidates.length) },
      resolveNext
    )
  );
  return statuses;
}

async function resolveColdConversationReclamationStatus(
  candidate: ColdConversationReclamationCandidate,
  monitor: ReturnType<typeof resolveRuntimeStatusMonitor>,
  codexRolloutPathBySessionId: ReadonlyMap<string, string>
): Promise<ColdConversationReclamationStatus | null> {
  if (candidate.runtimeId !== 'claude' && candidate.runtimeId !== 'codex') return null;
  const sessionSource = parseConversationSessionSource(candidate.config);

  if (candidate.runtimeId === 'claude' && monitor === 'activity') {
    const providerSessionId =
      sessionSource?.runtimeId === 'claude' ? sessionSource.sessionId : candidate.conversationId;
    if (
      candidate.processPid === undefined ||
      candidate.markerCreatedAtMs === undefined ||
      !candidate.cwd
    ) {
      return null;
    }
    const activity = await getClaudeSessionActivity({
      cwd: candidate.cwd || undefined,
      conversationId: providerSessionId,
      processPid: candidate.processPid,
      claudeHomeDir: sessionSource?.runtimeId === 'claude' ? sessionSource.stateRoot : undefined,
    });
    if (
      !activity ||
      activity.pid !== candidate.processPid ||
      activity.sessionId !== providerSessionId ||
      !activity.cwd ||
      normalize(activity.cwd) !== normalize(candidate.cwd) ||
      activity.updatedAt === null ||
      activity.updatedAt < candidate.markerCreatedAtMs
    ) {
      return null;
    }
    if (activity.status === 'busy') return 'working';
    if (activity.status === 'waiting') return 'awaiting-input';
    return 'idle';
  }

  if (candidate.runtimeId === 'claude' && monitor === 'transcript') {
    const providerSessionId =
      sessionSource?.runtimeId === 'claude' ? sessionSource.sessionId : candidate.conversationId;
    const transcriptPath =
      sessionSource?.runtimeId === 'claude'
        ? await findClaudeTranscriptPathBySessionId(providerSessionId, sessionSource.stateRoot)
        : candidate.cwd
          ? resolveClaudeTranscriptPath(candidate.cwd, providerSessionId)
          : await findClaudeTranscriptPathBySessionId(providerSessionId);
    if (!transcriptPath) return null;
    return (await readClaudeColdTurnVerdictFile(transcriptPath))?.state ?? null;
  }

  if (candidate.runtimeId === 'codex' && monitor === 'rollout') {
    // Reclamation must never infer a provider thread from title/cwd/time. The
    // persisted binding is the exact thread this Yoda conversation owns; old
    // conversations without one stay protected until explicitly opened again.
    if (sessionSource?.runtimeId !== 'codex') return null;
    const rolloutPath = codexRolloutPathBySessionId.get(candidate.sessionId);
    if (!rolloutPath) return null;
    const verdict = await readCodexTurnVerdictFile(rolloutPath);
    if (!verdict || verdict.lastStartedAt === null) return null;
    return verdict.state;
  }

  // Hook and terminal classifiers have no durable cold-state authority.
  return null;
}

async function resolveBoundCodexRolloutPaths(
  candidates: readonly ColdConversationReclamationCandidate[],
  getMonitor: (
    runtimeId: 'claude' | 'codex'
  ) => Promise<ReturnType<typeof resolveRuntimeStatusMonitor>>
): Promise<Map<string, string>> {
  if (!candidates.some((candidate) => candidate.runtimeId === 'codex')) return new Map();
  if ((await getMonitor('codex')) !== 'rollout') return new Map();
  const bindingsByStatePath = new Map<string, Array<{ sessionId: string; threadId: string }>>();
  for (const candidate of candidates) {
    if (candidate.runtimeId !== 'codex') continue;
    const source = parseConversationSessionSource(candidate.config);
    if (source?.runtimeId !== 'codex') continue;
    const statePath = resolveCodexStatePath(source.stateRoot);
    const bindings = bindingsByStatePath.get(statePath) ?? [];
    bindings.push({ sessionId: candidate.sessionId, threadId: source.sessionId });
    bindingsByStatePath.set(statePath, bindings);
  }

  const rolloutPathBySessionId = new Map<string, string>();
  for (const [statePath, bindings] of bindingsByStatePath) {
    try {
      const paths = readCodexThreadRolloutPaths(
        statePath,
        bindings.map((binding) => binding.threadId)
      );
      for (const binding of bindings) {
        const path = paths.get(binding.threadId);
        if (path) rolloutPathBySessionId.set(binding.sessionId, path);
      }
    } catch (error) {
      log.warn('Cold Codex state DB could not be inspected', {
        statePath,
        error: String(error),
      });
    }
  }
  return rolloutPathBySessionId;
}
