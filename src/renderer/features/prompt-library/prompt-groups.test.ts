import { describe, expect, it } from 'vitest';
import type { Prompt } from '@shared/prompt-library';
import {
  getInjectionOrderedPromptGroups,
  getNamedPromptGroups,
  getPromptGroupInjectionState,
  groupPrompts,
  reorderPromptIds,
  UNGROUPED_PROMPT_GROUP,
} from './prompt-groups';

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
    ).toEqual(['Writing', 'Build', 'Review']);
  });

  it('keeps persisted groups visible when they do not contain prompts', () => {
    const groups = groupPrompts([prompt('review', 'Review')], ['Review', 'Build']);

    expect(groups.map((group) => group.name)).toEqual(['Review', 'Build']);
    expect(groups[0]?.prompts.map((entry) => entry.id)).toEqual(['review']);
    expect(groups[1]?.prompts).toEqual([]);
  });

  it('reports all, partial, and empty group injection states', () => {
    const first = { ...prompt('first', 'Brand'), injectionEnabled: true };
    const second = prompt('second', 'Brand');

    expect(
      getPromptGroupInjectionState([first, second], (entry) => entry.injectionEnabled)
    ).toEqual({ state: 'partial', enabledCount: 1, totalCount: 2 });
    expect(getPromptGroupInjectionState([first], (entry) => entry.injectionEnabled).state).toBe(
      'all'
    );
    expect(getPromptGroupInjectionState([second], (entry) => entry.injectionEnabled).state).toBe(
      'none'
    );
  });

  it('keeps injection order within each group and reorders ids by drag target', () => {
    const groups = getInjectionOrderedPromptGroups([
      { ...prompt('second', 'Brand'), injectionOrder: 20 },
      { ...prompt('first', 'Brand'), injectionOrder: 10 },
    ]);

    expect(groups[0]?.prompts.map((entry) => entry.id)).toEqual(['first', 'second']);
    expect(reorderPromptIds(['first', 'second', 'third'], 'first', 'third')).toEqual([
      'second',
      'third',
      'first',
    ]);
  });
});
