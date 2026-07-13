import { describe, expect, it } from 'vitest';
import { INTERNAL_PROJECT_ID } from '@shared/projects';
import { resolveHomeProjectId } from '@renderer/app/home-project-selection';

describe('resolveHomeProjectId', () => {
  it('treats navigation from the internal Drafts project as explicitly projectless', () => {
    expect(
      resolveHomeProjectId({
        homeProjectId: INTERNAL_PROJECT_ID,
        draftProjectId: 'previous-project',
      })
    ).toBeUndefined();
  });

  it('does not restore an internal project persisted by an older draft', () => {
    expect(resolveHomeProjectId({ draftProjectId: INTERNAL_PROJECT_ID })).toBeUndefined();
  });

  it('keeps normal route projects ahead of the persisted draft', () => {
    expect(
      resolveHomeProjectId({ homeProjectId: 'route-project', draftProjectId: 'previous-project' })
    ).toBe('route-project');
  });

  it('keeps task-scoped internal projects locked for existing-task flows', () => {
    expect(
      resolveHomeProjectId({
        lockedProjectId: INTERNAL_PROJECT_ID,
        homeProjectId: 'route-project',
      })
    ).toBe(INTERNAL_PROJECT_ID);
  });
});
