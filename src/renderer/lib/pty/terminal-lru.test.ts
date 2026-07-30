import { describe, expect, it } from 'vitest';
import { selectTerminalLruEvictions } from './terminal-lru';

describe('selectTerminalLruEvictions', () => {
  it('keeps the current terminal and three most recently used terminals across 20 sessions', () => {
    const entries = Array.from({ length: 20 }, (_, index) => ({
      sessionId: `session-${index + 1}`,
      mounted: index === 19,
    }));
    expect(selectTerminalLruEvictions(entries, 4, 'session-20')).toEqual(
      Array.from({ length: 16 }, (_, index) => `session-${index + 1}`)
    );
  });

  it('never evicts another mounted split terminal', () => {
    expect(
      selectTerminalLruEvictions(
        [
          { sessionId: 'visible-a', mounted: true },
          { sessionId: 'hidden', mounted: false },
          { sessionId: 'visible-b', mounted: true },
        ],
        1,
        'visible-b'
      )
    ).toEqual(['hidden']);
  });
});
