import { describe, expect, it } from 'vitest';
import { quickActionSchema } from './project-settings';

describe('quickActionSchema', () => {
  it('keeps actions saved before programmatic quick actions as Agent instructions', () => {
    expect(
      quickActionSchema.parse({
        id: 'release',
        label: 'Release',
        command: '/release-via-cicd',
      })
    ).toEqual({
      id: 'release',
      label: 'Release',
      command: '/release-via-cicd',
      kind: 'agent',
    });
  });
});
