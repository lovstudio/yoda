import { describe, expect, it } from 'vitest';
import { withConversationOperation } from './conversation-operation-lock';

describe('conversation operation lock', () => {
  it('serializes one conversation without blocking another', async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const first = withConversationOperation(
      { projectId: 'project-1', id: 'conversation-1' },
      async () => {
        events.push('first:start');
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        events.push('first:end');
      }
    );
    const second = withConversationOperation(
      { projectId: 'project-1', id: 'conversation-1' },
      async () => {
        events.push('second');
      }
    );
    const independent = withConversationOperation(
      { projectId: 'project-1', id: 'conversation-2' },
      async () => {
        events.push('independent');
      }
    );

    await independent;
    expect(events).toEqual(['first:start', 'independent']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'independent', 'first:end', 'second']);
  });
});
