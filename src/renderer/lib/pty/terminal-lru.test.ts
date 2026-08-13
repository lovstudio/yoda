import { describe, expect, it } from 'vitest';
import { selectTerminalLruEvictions, selectTerminalPressureEvictions } from './terminal-lru';

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

  it('keeps a renderer that is still connecting', () => {
    expect(
      selectTerminalLruEvictions(
        [
          { sessionId: 'old', mounted: false },
          { sessionId: 'connecting', mounted: false, connecting: true },
          { sessionId: 'current', mounted: false },
        ],
        1,
        'current'
      )
    ).toEqual(['old']);
  });
});

describe('selectTerminalPressureEvictions', () => {
  it('does not evict any of 20 idle terminals without a pressure decision', () => {
    const entries = Array.from({ length: 20 }, (_, index) => ({
      sessionId: `session-${index + 1}`,
      mounted: false,
      recoverable: true,
    }));

    expect(selectTerminalLruEvictions(entries, Number.POSITIVE_INFINITY)).toEqual([]);
  });

  it('evicts the oldest quarter of safe frontend renderers under pressure', () => {
    const entries = Array.from({ length: 20 }, (_, index) => ({
      sessionId: `session-${index + 1}`,
      mounted: false,
      recoverable: true,
    }));

    expect(selectTerminalPressureEvictions(entries)).toEqual([
      'session-1',
      'session-2',
      'session-3',
      'session-4',
      'session-5',
    ]);
  });

  it('protects mounted, connecting and not-yet-snapshotted terminals', () => {
    expect(
      selectTerminalPressureEvictions([
        { sessionId: 'mounted', mounted: true, recoverable: true },
        { sessionId: 'connecting', mounted: false, connecting: true, recoverable: true },
        { sessionId: 'cold', mounted: false, recoverable: false },
        { sessionId: 'safe-old', mounted: false, recoverable: true },
        { sessionId: 'safe-new', mounted: false, recoverable: true },
      ])
    ).toEqual(['safe-old']);
  });
});
