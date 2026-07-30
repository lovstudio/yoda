import { describe, expect, it } from 'vitest';
import type { ClaudeSessionPrompt, ProjectPromptSource } from '@shared/conversations';
import { buildProjectPromptEntries, insertProjectPromptEntries } from './project-prompt-items';

function source(
  conversationId: string,
  lastInteractedAt: string,
  overrides: Partial<ProjectPromptSource['conversation']> = {}
): ProjectPromptSource {
  return {
    conversation: {
      id: conversationId,
      projectId: 'project-1',
      taskId: `task-${conversationId}`,
      runtimeId: 'codex',
      title: conversationId,
      lastInteractedAt,
      isInitialConversation: false,
      ...overrides,
    },
    taskName: `Task ${conversationId}`,
    taskArchivedAt: null,
  };
}

function prompt(id: string, timestamp: string | null): ClaudeSessionPrompt {
  return { id, text: `Prompt ${id}`, timestamp };
}

describe('project prompt progressive ordering', () => {
  it('inserts files that finish out of order into newest-first positions', () => {
    const known = new Set(['older', 'newer']);
    const older = buildProjectPromptEntries(
      source('older', '2026-01-01T10:00:00.000Z'),
      [prompt('older-1', '2026-01-01T10:00:00.000Z')],
      1,
      known
    );
    const newer = buildProjectPromptEntries(
      source('newer', '2026-01-02T10:00:00.000Z'),
      [
        prompt('newer-1', '2026-01-02T09:00:00.000Z'),
        prompt('newer-2', '2026-01-02T10:00:00.000Z'),
      ],
      0,
      known
    );

    const firstPaint = insertProjectPromptEntries([], older);
    const completed = insertProjectPromptEntries(firstPaint, newer);

    expect(completed.map((entry) => entry.prompt.id)).toEqual(['newer-2', 'newer-1', 'older-1']);
  });

  it('omits copied parent history from a known fork while preserving its new prompts', () => {
    const parent = source('parent', '2026-01-01T10:00:00.000Z');
    const child = source('child', '2026-01-02T10:00:00.000Z', {
      forkedFromConversationId: 'parent',
      forkedFromPromptIndex: 1,
    });
    const prompts = [
      prompt('copied-1', null),
      prompt('copied-2', null),
      prompt('child-1', '2026-01-02T10:00:00.000Z'),
    ];
    const known = new Set([parent.conversation.id, child.conversation.id]);

    expect(
      buildProjectPromptEntries(child, prompts, 1, known).map((entry) => entry.prompt.id)
    ).toEqual(['child-1']);
  });

  it('keeps a fork transcript intact when its parent is no longer indexed', () => {
    const child = source('child', '2026-01-02T10:00:00.000Z', {
      forkedFromConversationId: 'deleted-parent',
      forkedFromPromptIndex: 0,
    });
    const entries = buildProjectPromptEntries(
      child,
      [prompt('surviving-history', null), prompt('child-1', null)],
      0,
      new Set(['child'])
    );

    expect(entries.map((entry) => entry.prompt.id)).toEqual(['surviving-history', 'child-1']);
  });
});
