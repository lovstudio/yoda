import { describe, expect, it } from 'vitest';
import type { Prompt } from '@shared/prompt-library';
import {
  collectPromptTags,
  filterPrompts,
  normalizePromptList,
  reorderPromptIds,
  reorderPromptIdsInVisibleList,
} from './prompt-tags';

function prompt(id: string, tags: string[], injectionEnabled = false): Prompt {
  return {
    id,
    title: id,
    description: `${id} description`,
    content: `${id} content`,
    tags,
    extraInfo: '',
    injectionEnabled,
    injectionOrder: 0,
    bindings: { global: true, projectIds: [] },
    version: '1.0.0',
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
  };
}

describe('prompt tags', () => {
  it('backfills tags when an older prompt payload omits the field', () => {
    const { tags: _tags, ...legacyPrompt } = prompt('legacy', ['Review']);

    expect(normalizePromptList([legacyPrompt])).toEqual([prompt('legacy', [])]);
  });

  it('collects unique tags in a stable display order', () => {
    expect(
      collectPromptTags([
        prompt('first', ['Review', 'Writing']),
        prompt('second', ['Writing', 'Release']),
      ])
    ).toEqual(['Release', 'Review', 'Writing']);
  });

  it('filters by tag, status, and searchable prompt metadata', () => {
    const prompts = [prompt('review', ['Review'], true), prompt('release', ['Release'])];
    expect(filterPrompts(prompts, { tag: 'Review' }).map((item) => item.id)).toEqual(['review']);
    expect(filterPrompts(prompts, { status: 'enabled' }).map((item) => item.id)).toEqual([
      'review',
    ]);
    expect(filterPrompts(prompts, { query: 'release' }).map((item) => item.id)).toEqual([
      'release',
    ]);
  });

  it('reorders a flat list by drag target', () => {
    expect(reorderPromptIds(['first', 'second', 'third'], 'first', 'third')).toEqual([
      'second',
      'third',
      'first',
    ]);
  });

  it('reorders a filtered subset without changing hidden prompt slots', () => {
    expect(
      reorderPromptIdsInVisibleList(
        ['first', 'hidden', 'second', 'third'],
        ['first', 'second', 'third'],
        'first',
        'third'
      )
    ).toEqual(['second', 'hidden', 'third', 'first']);
  });
});
