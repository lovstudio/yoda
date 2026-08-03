import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteTerminal } from './deleteTerminal';

const mocks = vi.hoisted(() => ({
  deleteRows: vi.fn(),
  fromDelete: { where: vi.fn() },
  killTerminal: vi.fn(),
  resolveTask: vi.fn(),
  capture: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: { delete: mocks.deleteRows },
}));

vi.mock('../projects/utils', () => ({
  resolveTask: mocks.resolveTask,
  withTimeout: <T>(promise: Promise<T>) => promise,
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: { capture: mocks.capture },
}));

vi.mock('@main/lib/logger', () => ({
  log: { warn: mocks.warn },
}));

describe('deleteTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteRows.mockReturnValue(mocks.fromDelete);
    mocks.fromDelete.where.mockResolvedValue(undefined);
    mocks.resolveTask.mockReturnValue({ terminals: { killTerminal: mocks.killTerminal } });
    mocks.killTerminal.mockResolvedValue(undefined);
  });

  it('does not resurrect a durably deleted terminal when provider cleanup fails', async () => {
    mocks.killTerminal.mockRejectedValueOnce(new Error('remote tmux unavailable'));

    await expect(
      deleteTerminal({ projectId: 'project-1', taskId: 'task-1', terminalId: 'terminal-1' })
    ).resolves.toBeUndefined();

    expect(mocks.warn).toHaveBeenCalledWith(
      'deleteTerminal: terminal cleanup failed after durable deletion',
      expect.objectContaining({ terminalId: 'terminal-1' })
    );
    expect(mocks.capture).toHaveBeenCalledWith(
      'terminal_deleted',
      expect.objectContaining({ terminal_id: 'terminal-1' })
    );
  });
});
