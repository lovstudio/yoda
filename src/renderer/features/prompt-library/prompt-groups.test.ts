import { describe, expect, it } from 'vitest';
import type { Prompt } from '@shared/prompt-library';
import {
  getGroupDescendants,
  getGroupPath,
  getInjectionOrderedPromptGroups,
  getNamedPromptGroups,
  getVisiblePromptGroups,
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
        [{ name: 'Writing', parentName: null }]
      )
    ).toEqual(['Writing', 'Build', 'Review']);
  });

  it('keeps persisted groups visible when they do not contain prompts', () => {
    const groups = groupPrompts(
      [prompt('review', 'Review')],
      [
        { name: 'Review', parentName: null },
        { name: 'Build', parentName: null },
      ]
    );

    expect(groups.map((group) => group.name)).toEqual(['Review', 'Build']);
    expect(groups[0]?.prompts.map((entry) => entry.id)).toEqual(['review']);
    expect(groups[1]?.prompts).toEqual([]);
  });

  it('flattens nested groups depth-first and hides descendants of collapsed groups', () => {
    const persistedGroups = [
      { name: 'Engineering', parentName: null },
      { name: 'Frontend', parentName: 'Engineering' },
      { name: 'React', parentName: 'Frontend' },
      { name: 'Writing', parentName: null },
    ];
    const groups = groupPrompts([prompt('react', 'React')], persistedGroups);

    expect(groups.map(({ name, depth }) => ({ name, depth }))).toEqual([
      { name: 'Engineering', depth: 0 },
      { name: 'Frontend', depth: 1 },
      { name: 'React', depth: 2 },
      { name: 'Writing', depth: 0 },
    ]);
    expect(
      getVisiblePromptGroups(groups, new Set(['Frontend'])).map((group) => group.name)
    ).toEqual(['Engineering', 'Frontend', 'Writing']);
    expect(getGroupDescendants(persistedGroups, 'Engineering')).toEqual(
      new Set(['Frontend', 'React'])
    );
    expect(getGroupPath(persistedGroups, 'React')).toBe('Engineering / Frontend / React');
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
