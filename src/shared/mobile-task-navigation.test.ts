import { describe, expect, it } from 'vitest';
import { resolveMobileTaskEntry } from '../../apps/mobile/src/task-navigation';

describe('mobile task entry', () => {
  it('opens the only session directly', () => {
    expect(resolveMobileTaskEntry([{ id: 'session-1' }])).toEqual({
      kind: 'session',
      sessionId: 'session-1',
    });
  });

  it('keeps tasks with no or multiple sessions on the task surface', () => {
    expect(resolveMobileTaskEntry([])).toEqual({ kind: 'task' });
    expect(resolveMobileTaskEntry([{ id: 'session-1' }, { id: 'session-2' }])).toEqual({
      kind: 'task',
    });
  });
});
