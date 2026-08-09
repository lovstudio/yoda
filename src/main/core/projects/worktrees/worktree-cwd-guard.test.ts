import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { TmuxSessionMarker } from '@main/core/pty/tmux-session-name';
import { assertNoTmuxSessionUsesWorktree } from './worktree-cwd-guard';

const ctx = {} as IExecutionContext;

function marker(cwd: string): TmuxSessionMarker {
  return {
    sessionName: 'yoda-dGVzdA',
    cwd,
    attachedClients: 0,
  };
}

describe('assertNoTmuxSessionUsesWorktree', () => {
  let root: string;
  let worktreePath: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-cwd-guard-'));
    worktreePath = path.join(root, 'worktree');
    fs.mkdirSync(path.join(worktreePath, 'nested'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each(['root', 'nested'] as const)(
    'blocks a tmux cwd at or inside the worktree: %s',
    async (location) => {
      const cwd = location === 'root' ? worktreePath : path.join(worktreePath, 'nested');

      await expect(
        assertNoTmuxSessionUsesWorktree(ctx, worktreePath, {
          listMarkers: async () => [marker(cwd)],
        })
      ).rejects.toThrow('still used as cwd');
    }
  );

  it('allows a tmux cwd in a sibling directory', async () => {
    const sibling = path.join(root, 'worktree-old');
    fs.mkdirSync(sibling);

    await expect(
      assertNoTmuxSessionUsesWorktree(ctx, worktreePath, {
        listMarkers: async () => [marker(sibling)],
      })
    ).resolves.toBeUndefined();
  });

  it('propagates marker enumeration failure so cleanup fails closed', async () => {
    const listError = new Error('tmux list timed out');

    await expect(
      assertNoTmuxSessionUsesWorktree(ctx, worktreePath, {
        listMarkers: vi.fn().mockRejectedValue(listError),
      })
    ).rejects.toBe(listError);
  });
});
