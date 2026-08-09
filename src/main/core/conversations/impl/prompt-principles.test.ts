import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prompt } from '@shared/prompt-library';
import { getEnabledPromptPrinciplesText } from './prompt-principles';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
}));

vi.mock('@main/core/prompt-library/prompt-library-service', () => ({
  promptLibraryService: { list: mocks.list },
}));

function prompt(id: string, content: string, enabled: boolean, order: number): Prompt {
  return {
    id,
    title: id,
    description: '',
    content,
    tags: [],
    extraInfo: '',
    injectionEnabled: enabled,
    injectionOrder: order,
    version: '1.0.0',
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
  };
}

describe('dynamic prompt injection', () => {
  beforeEach(() => {
    mocks.list.mockResolvedValue([
      prompt('later', 'Later', true, 20),
      prompt('disabled', 'Project enabled', false, 10),
      prompt('first', 'First', true, 0),
    ]);
  });

  it('injects enabled library prompts in the configured order', async () => {
    await expect(getEnabledPromptPrinciplesText()).resolves.toBe('First\n\nLater');
  });

  it('applies project overrides and appends project-only prompts', async () => {
    await expect(
      getEnabledPromptPrinciplesText({
        globalOverrides: { first: false, disabled: true },
        items: [{ id: 'local', name: 'Local', text: 'Local prompt', enabled: true }],
      })
    ).resolves.toBe('Project enabled\n\nLater\n\nLocal prompt');
  });
});
