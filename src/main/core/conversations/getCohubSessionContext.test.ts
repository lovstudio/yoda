import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getCohubSessionContext } from './getCohubSessionContext';

describe('getCohubSessionContext', () => {
  let userDataPath: string | undefined;

  afterEach(async () => {
    if (userDataPath) await rm(userDataPath, { recursive: true, force: true });
  });

  it('maps persisted Cohub turns to prompt and transcript history', async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'cohub-session-context-'));
    const stateDirectory = join(userDataPath, 'cohub', 'sessions');
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(
      join(stateDirectory, 'conversation-1.json'),
      JSON.stringify({
        turns: [
          {
            id: 'turn-1',
            userText: '继续处理',
            assistantText: '已经完成',
            createdAt: '2026-08-07T07:44:24.274Z',
            completedAt: '2026-08-07T07:44:26.145Z',
          },
        ],
      })
    );

    await expect(getCohubSessionContext('conversation-1', userDataPath)).resolves.toEqual({
      prompts: [
        {
          id: 'turn-1',
          text: '继续处理',
          timestamp: '2026-08-07T07:44:24.274Z',
        },
      ],
      messages: [
        {
          id: 'turn-1',
          role: 'user',
          text: '继续处理',
          timestamp: '2026-08-07T07:44:24.274Z',
        },
        {
          id: 'turn-1:assistant',
          role: 'assistant',
          text: '已经完成',
          timestamp: '2026-08-07T07:44:26.145Z',
          phase: 'final',
        },
      ],
      compactions: [],
    });
  });
});
