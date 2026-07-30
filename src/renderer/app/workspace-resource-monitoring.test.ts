import { describe, expect, it } from 'vitest';
import {
  WORKSPACE_RESOURCE_POLL_INTERVAL_MS,
  WORKSPACE_RESOURCE_QUERY_TIMING,
} from './workspace-resource-monitoring';

describe('workspace resource monitoring', () => {
  it('continues sampling while the Yoda window is in the background', () => {
    expect(WORKSPACE_RESOURCE_QUERY_TIMING).toMatchObject({
      refetchInterval: WORKSPACE_RESOURCE_POLL_INTERVAL_MS,
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: false,
    });
  });
});
