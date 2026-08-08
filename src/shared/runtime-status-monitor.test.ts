import { describe, expect, it } from 'vitest';
import {
  getDefaultRuntimeStatusMonitor,
  getRuntimeStatusMonitors,
  resolveRuntimeStatusMonitor,
} from './runtime-status-monitor';

describe('runtime status monitors', () => {
  it('uses PID activity by default for Claude while preserving explicit alternatives', () => {
    expect(getRuntimeStatusMonitors('claude').map((item) => item.id)).toEqual([
      'activity',
      'transcript',
      'hooks',
    ]);
    expect(getDefaultRuntimeStatusMonitor('claude')).toBe('activity');
    expect(resolveRuntimeStatusMonitor('claude', 'transcript')).toBe('transcript');
  });

  it('uses rollout by default for Codex', () => {
    expect(getDefaultRuntimeStatusMonitor('codex')).toBe('rollout');
  });

  it('falls back to the client recommendation for an unsupported selection', () => {
    expect(resolveRuntimeStatusMonitor('claude', 'rollout')).toBe('activity');
    expect(resolveRuntimeStatusMonitor('gemini', 'transcript')).toBe('terminal');
  });
});
