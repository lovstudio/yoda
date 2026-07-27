import { describe, expect, it } from 'vitest';
import type { Prompt } from '@shared/prompt-library';
import { getNamedPromptGroups, groupPrompts, UNGROUPED_PROMPT_GROUP } from './prompt-groups';

function prompt(id: string, groupName: string): Prompt {
  return {
    id,
    title: id,
    description: '',
    content: `${id} content`,
    groupName,
    extraInfo: '',
    injectionEnabled: false,
    injectionOrder: 0,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
  };
}

describe('prompt groups', () => {
  it('groups prompts, trims group names, and keeps prompt order within each group', () => {
    const groups = groupPrompts([
      prompt('review-first', ' Review '),
      prompt('ungrouped', '  '),
      prompt('build', 'Build'),
      prompt('review-second', 'Review'),
    ]);

    expect(groups.map((group) => group.name)).toEqual(['Build', 'Review', UNGROUPED_PROMPT_GROUP]);
    expect(groups[1]?.prompts.map((entry) => entry.id)).toEqual(['review-first', 'review-second']);
  });

  it('returns reusable named groups without the ungrouped bucket', () => {
    expect(
      getNamedPromptGroups(
        [prompt('ungrouped', ''), prompt('review', 'Review'), prompt('build', 'Build')],
        ['Writing']
      )
    ).toEqual(['Build', 'Review', 'Writing']);
  });

  it('keeps persisted groups visible when they do not contain prompts', () => {
    const groups = groupPrompts([prompt('review', 'Review')], ['Build', 'Review']);

    expect(groups.map((group) => group.name)).toEqual(['Build', 'Review']);
    expect(groups[0]?.prompts).toEqual([]);
    expect(groups[1]?.prompts.map((entry) => entry.id)).toEqual(['review']);
  });
});
