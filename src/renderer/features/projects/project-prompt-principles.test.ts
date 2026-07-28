import { describe, expect, it } from 'vitest';
import type { Prompt } from '@shared/prompt-library';
import { setGlobalOverrides } from './project-prompt-principles';

function prompt(id: string, injectionEnabled: boolean): Pick<Prompt, 'id' | 'injectionEnabled'> {
  return { id, injectionEnabled };
}

describe('project prompt principle group overrides', () => {
  it('stores only group overrides that differ from global defaults', () => {
    expect(
      setGlobalOverrides(undefined, [prompt('bio', false), prompt('assets', true)], true)
    ).toEqual({
      globalOverrides: { bio: true },
    });

    expect(
      setGlobalOverrides(
        { globalOverrides: { other: false, bio: true } },
        [prompt('bio', false), prompt('assets', true)],
        false
      )
    ).toEqual({
      globalOverrides: { other: false, assets: false },
    });
  });
});
