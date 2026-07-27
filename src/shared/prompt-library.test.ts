import { describe, expect, it } from 'vitest';
import { promptCreateInputSchema, promptUpdateInputSchema } from './prompt-library';

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
    });
  });

  it('accepts moving an existing prompt to a group', () => {
    expect(promptUpdateInputSchema.parse({ groupName: 'Review' })).toEqual({
      groupName: 'Review',
    });
  });
});
