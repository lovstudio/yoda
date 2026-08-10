import { describe, expect, it } from 'vitest';
import {
  incrementPromptVersion,
  isPromptAvailableForTarget,
  isPromptBoundToScope,
  normalizePromptTags,
  promptCreateInputSchema,
  promptSourceSchema,
  promptUpdateInputSchema,
} from './prompt-library';

describe('prompt library schemas', () => {
  it('keeps existing create callers compatible by defaulting to no tags', () => {
    expect(
      promptCreateInputSchema.parse({
        title: 'Review',
        content: 'Review this change.',
      })
    ).toMatchObject({
      description: '',
      tags: [],
      extraInfo: '',
      injectionEnabled: false,
      bindings: { global: true, workspaceIds: [], projectIds: [] },
    });
  });

  it('accepts human-only tags without changing prompt content', () => {
    expect(promptUpdateInputSchema.parse({ tags: [' Review ', 'Writing', 'Review'] })).toEqual({
      tags: ['Review', 'Writing', 'Review'],
    });
  });

  it('normalizes duplicate and whitespace-only tags for storage', () => {
    expect(normalizePromptTags([' Review ', '', 'Review', ' Writing '])).toEqual([
      'Review',
      'Writing',
    ]);
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

  it('keeps configuration tabs separate from runtime availability', () => {
    const global = { bindings: { global: true, workspaceIds: [], projectIds: [] } };
    const project = { bindings: { global: false, workspaceIds: [], projectIds: ['project-1'] } };
    const organization = {
      bindings: { global: false, workspaceIds: ['workspace-1'], projectIds: [] },
    };

    expect(isPromptBoundToScope(global, 'user')).toBe(true);
    expect(isPromptBoundToScope(global, 'project', 'project-1')).toBe(false);
    expect(isPromptBoundToScope(project, 'project', 'project-1')).toBe(true);
    expect(isPromptBoundToScope(organization, 'project', { workspaceId: 'workspace-1' })).toBe(
      true
    );
    expect(
      isPromptAvailableForTarget(global, { projectId: 'project-1', workspaceId: 'workspace-1' })
    ).toBe(true);
    expect(
      isPromptAvailableForTarget(organization, {
        projectId: 'project-1',
        workspaceId: 'workspace-1',
      })
    ).toBe(true);
    expect(isPromptAvailableForTarget(project, { projectId: 'project-2' })).toBe(false);
  });
});
