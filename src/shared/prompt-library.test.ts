import { describe, expect, it } from 'vitest';
import {
  incrementPromptVersion,
  promptCreateInputSchema,
  promptSourceSchema,
  promptUpdateInputSchema,
} from './prompt-library';

describe('prompt library schemas', () => {
  it('keeps existing create callers compatible by defaulting to no group', () => {
    expect(
      promptCreateInputSchema.parse({
        title: 'Review',
        content: 'Review this change.',
      })
    ).toMatchObject({
      description: '',
      groupName: '',
      extraInfo: '',
      injectionEnabled: false,
    });
  });

  it('accepts moving an existing prompt to a group', () => {
    expect(promptUpdateInputSchema.parse({ groupName: 'Review' })).toEqual({
      groupName: 'Review',
    });
  });

  it('increments semantic prompt versions by patch, minor, or major', () => {
    expect(incrementPromptVersion('1.2.3', 'patch')).toBe('1.2.4');
    expect(incrementPromptVersion('1.2.3', 'minor')).toBe('1.3.0');
    expect(incrementPromptVersion('1.2.3', 'major')).toBe('2.0.0');
  });

  it('accepts a Git repository file as a prompt content source', () => {
    expect(
      promptSourceSchema.parse({
        type: 'git',
        repositoryUrl: 'https://github.com/lovstudio/prompts.git',
        filePath: 'review/code-review.md',
        ref: 'main',
        refreshIntervalMinutes: 60,
        timeoutSeconds: 10,
      })
    ).toMatchObject({
      type: 'git',
      filePath: 'review/code-review.md',
    });
  });
});
