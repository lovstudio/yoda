import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePtySessionId } from '@shared/ptySessionId';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { createTerminal } from './createTerminal';

const mocks = vi.hoisted(() => ({
  captureTelemetry: vi.fn(),
  resolveTask: vi.fn(),
  spawnTerminal: vi.fn(),
  insertChain: {
    values: vi.fn(),
    returning: vi.fn(),
  },
  deleteChain: {
    where: vi.fn(),
  },
}));

vi.mock('@main/db/client', () => ({
  db: {
    insert: vi.fn(() => mocks.insertChain),
    delete: vi.fn(() => mocks.deleteChain),
  },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: { capture: mocks.captureTelemetry },
}));

vi.mock('../projects/utils', () => ({
  resolveTask: mocks.resolveTask,
}));

vi.mock('./core', () => ({
  mapTerminalRowToTerminal: vi.fn((row: unknown) => row),
}));

const params = {
  id: 'terminal-1',
  projectId: 'project-1',
  taskId: 'task-1',
  name: 'Terminal',
};
const row = {
  ...params,
  ssh: 0,
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z',
};
const sessionId = makePtySessionId(params.projectId, params.taskId, params.id);

describe('createTerminal registration lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertChain.values.mockReturnThis();
    mocks.insertChain.returning.mockResolvedValue([row]);
    mocks.deleteChain.where.mockResolvedValue(undefined);
    mocks.resolveTask.mockReturnValue({
      terminals: { spawnTerminal: mocks.spawnTerminal },
    });
    mocks.spawnTerminal.mockResolvedValue(undefined);
  });

  afterEach(() => {
    ptySessionRegistry.unregister(sessionId);
  });

  it('starts the backend while the creation registration remains current', async () => {
    await expect(createTerminal(params)).resolves.toMatchObject(params);

    expect(mocks.spawnTerminal).toHaveBeenCalledTimes(1);
    expect(mocks.deleteChain.where).not.toHaveBeenCalled();
  });

  it('rolls back the row when delete cancels registration during insert', async () => {
    let finishInsert!: (rows: unknown[]) => void;
    mocks.insertChain.returning.mockReturnValueOnce(
      new Promise((resolve) => {
        finishInsert = resolve;
      })
    );

    const creation = createTerminal(params);
    ptySessionRegistry.unregister(sessionId);
    finishInsert([row]);

    await expect(creation).rejects.toThrow('cancelled during persistence');
    expect(mocks.deleteChain.where).toHaveBeenCalledOnce();
    expect(mocks.spawnTerminal).not.toHaveBeenCalled();
    expect(ptySessionRegistry.writeOrQueue(sessionId, 'late input')).toBe('unavailable');
  });
});
