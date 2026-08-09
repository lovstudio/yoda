import { describe, expect, it } from 'vitest';
import {
  getHarnessContextQueryTiming,
  HARNESS_CONTEXT_REFRESH_MS,
} from './harness-context-monitoring';

describe('harness context monitoring', () => {
  it('pauses expensive harness discovery while its blind is inactive', () => {
    expect(getHarnessContextQueryTiming(false)).toMatchObject({
      enabled: false,
      refetchInterval: false,
      refetchIntervalInBackground: false,
    });
  });

  it('uses a low-frequency refresh while the harness is visible', () => {
    expect(getHarnessContextQueryTiming(true)).toMatchObject({
      enabled: true,
      refetchInterval: 30_000,
      staleTime: 29_000,
    });
    expect(HARNESS_CONTEXT_REFRESH_MS).toBe(30_000);
  });
});
