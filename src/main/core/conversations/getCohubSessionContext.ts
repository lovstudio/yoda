import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import type {
  ClaudeSessionPrompt,
  SessionCompaction,
  SessionTranscriptMessage,
} from '@shared/conversations';

type StoredCohubTurn = {
  assistantText?: unknown;
  completedAt?: unknown;
  createdAt?: unknown;
  id?: unknown;
  userText?: unknown;
};

type StoredCohubState = {
  turns?: unknown;
};

export type CohubSessionContext = {
  messages: SessionTranscriptMessage[];
  prompts: ClaudeSessionPrompt[];
  /** Cohub keeps whole turns, so its history has no compaction boundaries. */
  compactions: SessionCompaction[];
};

export async function getCohubSessionContext(
  conversationId: string,
  userDataPath = app.getPath('userData')
): Promise<CohubSessionContext | null> {
  let state: StoredCohubState;
  try {
    state = JSON.parse(
      await readFile(join(userDataPath, 'cohub', 'sessions', `${conversationId}.json`), 'utf8')
    ) as StoredCohubState;
  } catch {
    return null;
  }

  if (!Array.isArray(state.turns)) return { prompts: [], messages: [], compactions: [] };
  const prompts: ClaudeSessionPrompt[] = [];
  const messages: SessionTranscriptMessage[] = [];
  for (const candidate of state.turns) {
    if (!candidate || typeof candidate !== 'object') continue;
    const turn = candidate as StoredCohubTurn;
    if (typeof turn.id !== 'string' || typeof turn.userText !== 'string') continue;
    const createdAt = typeof turn.createdAt === 'string' ? turn.createdAt : null;
    const prompt = { id: turn.id, text: turn.userText, timestamp: createdAt };
    prompts.push(prompt);
    messages.push({ ...prompt, role: 'user' });
    if (typeof turn.assistantText === 'string' && turn.assistantText.trim()) {
      messages.push({
        id: `${turn.id}:assistant`,
        role: 'assistant',
        text: turn.assistantText,
        timestamp: typeof turn.completedAt === 'string' ? turn.completedAt : createdAt,
        phase: 'final',
      });
    }
  }
  return { prompts, messages, compactions: [] };
}
