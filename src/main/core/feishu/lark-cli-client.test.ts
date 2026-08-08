import { describe, expect, it, vi } from 'vitest';
import { LarkCliClient } from './lark-cli-client';

function json(value: unknown) {
  return { stdout: JSON.stringify(value), stderr: '' };
}

describe('LarkCliClient', () => {
  it('uses incomplete-task shortcuts with bounded pagination', async () => {
    const execute = vi.fn().mockResolvedValue(
      json({
        ok: true,
        data: {
          items: [{ guid: 'task-1', summary: 'Task one' }],
        },
      })
    );
    const client = new LarkCliClient({
      resolveExecutable: async () => '/usr/local/bin/lark-cli',
      execute,
    });

    await expect(client.listTasks(75)).resolves.toEqual([{ guid: 'task-1', summary: 'Task one' }]);
    expect(execute).toHaveBeenCalledWith(
      '/usr/local/bin/lark-cli',
      ['task', '+get-my-tasks', '--complete=false', '--page-limit', '2', '--json'],
      30_000
    );
  });

  it('keeps the device code in the main process while completing authorization', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          verification_url: 'https://accounts.feishu.cn/open-apis/authen/v1/index?code=test',
          device_code: 'device-code-1',
        })
      )
      .mockResolvedValueOnce(
        json({
          event: 'authorization_complete',
          user_open_id: 'ou_mark',
          granted: ['task:task:read'],
        })
      )
      .mockResolvedValueOnce(
        json({
          identity: 'user',
          verified: true,
          identities: { user: { available: true, verified: true } },
        })
      );
    const client = new LarkCliClient({
      resolveExecutable: async () => '/usr/local/bin/lark-cli',
      execute,
    });

    await expect(client.startAuthorization()).resolves.toEqual({
      verificationUrl: 'https://accounts.feishu.cn/open-apis/authen/v1/index?code=test',
    });
    await expect(client.completeAuthorization()).resolves.toEqual(
      expect.objectContaining({ identity: 'user', verified: true })
    );
    expect(execute.mock.calls[1]?.[1]).toEqual([
      'auth',
      'login',
      '--device-code',
      'device-code-1',
      '--json',
    ]);
  });

  it('surfaces structured CLI authorization errors with their recovery hint', async () => {
    const execute = vi.fn().mockRejectedValue({
      stderr: JSON.stringify({
        ok: false,
        error: {
          message: 'missing required scope(s): task:task:read',
          hint: 'run lark-cli auth login',
        },
      }),
    });
    const client = new LarkCliClient({
      resolveExecutable: async () => '/usr/local/bin/lark-cli',
      execute,
    });

    await expect(client.listTasks(20)).rejects.toThrow(
      'missing required scope(s): task:task:read\nrun lark-cli auth login'
    );
  });
});
