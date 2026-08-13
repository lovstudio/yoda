import { describe, expect, it } from 'vitest';
import { dedupeTranscriptAttributions } from './transcript-attribution';

describe('dedupeTranscriptAttributions', () => {
  it('counts each transcript once and prefers an exact binding', () => {
    expect(
      dedupeTranscriptAttributions([
        { transcriptKey: '/rollout/a', priority: 0, value: 'heuristic-a' },
        { transcriptKey: '/rollout/b', priority: 0, value: 'only-b' },
        { transcriptKey: '/rollout/a', priority: 1, value: 'exact-a' },
      ])
    ).toEqual(['exact-a', 'only-b']);
  });

  it('keeps the first candidate when priorities tie', () => {
    expect(
      dedupeTranscriptAttributions([
        { transcriptKey: '/rollout/a', priority: 0, value: 'first' },
        { transcriptKey: '/rollout/a', priority: 0, value: 'second' },
      ])
    ).toEqual(['first']);
  });
});
