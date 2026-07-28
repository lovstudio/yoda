import { describe, expect, it } from 'vitest';
import { makePtySessionId, parsePtySessionId } from './ptySessionId';

describe('PTY session ids', () => {
  it('round-trips a leaf id containing colons', () => {
    const id = makePtySessionId('project-1', 'task-1', 'conversation:branch:1');

    expect(parsePtySessionId(id)).toEqual({
      projectId: 'project-1',
      scopeId: 'task-1',
      leafId: 'conversation:branch:1',
    });
  });

  it('rejects incomplete ids', () => {
    expect(parsePtySessionId('project-1:task-1')).toBeNull();
    expect(parsePtySessionId(':task-1:conversation-1')).toBeNull();
  });
});
