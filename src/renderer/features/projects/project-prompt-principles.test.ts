import { describe, expect, it } from 'vitest';
import type { Prompt } from '@shared/prompt-library';
import { effectiveGlobalEnabled, setGlobalOverride } from './project-prompt-principles';

function prompt(id: string, injectionEnabled: boolean): Pick<Prompt, 'id' | 'injectionEnabled'> {
  return { id, injectionEnabled };
}

describe('project prompt principle overrides', () => {
  it('stores only an individual override that differs from the global default', () => {
    const entry = prompt('bio', false);
    const project = setGlobalOverride(undefined, entry, true);

    expect(project).toEqual({ globalOverrides: { bio: true } });
    expect(effectiveGlobalEnabled(project, entry)).toBe(true);
    expect(setGlobalOverride(project, entry, false)).toBeUndefined();
  });
});
