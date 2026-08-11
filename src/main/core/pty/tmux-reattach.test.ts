import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { Pty, PtyExitInfo } from './pty';
import { TmuxReattachMissError, waitForTmuxReattach } from './tmux-reattach';

const mocks = vi.hoisted(() => ({
  listTmuxSessionMarkersStrict: vi.fn(),
}));

vi.mock('./tmux-session-name', () => ({
  listTmuxSessionMarkersStrict: mocks.listTmuxSessionMarkersStrict,
}));

class FakePty implements Pty {
  private readonly exitHandlers: Array<(info: PtyExitInfo) => void> = [];
  write(): void {}
  resize(): void {}
  kill(): void {}
  onData(): void {}
  onExit(handler: (info: PtyExitInfo) => void): void {
    this.exitHandlers.push(handler);
  }
  emitExit(info: PtyExitInfo): void {
    for (const handler of this.exitHandlers) handler(info);
  }
}

const baseline = {
  sessionName: 'yoda-session',
  cwd: '/workspace',
  panePid: 123,
  createdAtMs: 1_000,
  attachedClients: 0,
};

describe('tmux reattach confirmation', () => {
  it('confirms only after the sampled session gains an attached client', async () => {
    mocks.listTmuxSessionMarkersStrict.mockResolvedValueOnce([{ ...baseline, attachedClients: 1 }]);

    await expect(
      waitForTmuxReattach({
        ctx: {} as IExecutionContext,
        pty: new FakePty(),
        baseline,
      })
    ).resolves.toBeUndefined();
  });

  it('rejects when the attach PTY exits before positive marker evidence', async () => {
    let finishList!: (markers: (typeof baseline)[]) => void;
    mocks.listTmuxSessionMarkersStrict.mockReturnValueOnce(
      new Promise((resolve) => {
        finishList = resolve;
      })
    );
    const pty = new FakePty();
    const confirmation = waitForTmuxReattach({
      ctx: {} as IExecutionContext,
      pty,
      baseline,
    });

    pty.emitExit({ exitCode: 75 });
    finishList([baseline]);

    await expect(confirmation).rejects.toBeInstanceOf(TmuxReattachMissError);
  });
});
