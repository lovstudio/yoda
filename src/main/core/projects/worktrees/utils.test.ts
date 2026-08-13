import { describe, expect, it, vi } from 'vitest';
import { resolveTaskWorkDir } from './utils';
import type { WorktreeService } from './worktree-service';

vi.mock('../../tasks/provision-task-error', () => ({
  mapWorktreeErrorToProvisionError: vi.fn((_branch: string, error: unknown) => error),
}));

function worktreeServiceMock(overrides: Partial<WorktreeService> = {}): WorktreeService {
  return {
    getWorktree: vi.fn().mockResolvedValue(undefined),
    checkoutExistingBranch: vi.fn(),
    checkoutBranchWorktree: vi.fn(),
    ...overrides,
  } as unknown as WorktreeService;
}

describe('resolveTaskWorkDir', () => {
  it('reuses the project-root checkout for a previously provisioned task', async () => {
    const getWorktree = vi.fn().mockResolvedValue('/repo');
    const service = worktreeServiceMock({ getWorktree });

    await expect(
      resolveTaskWorkDir(
        {
          taskBranch: 'main',
          sourceBranch: {
            type: 'remote',
            branch: 'main',
            remote: { name: 'origin', url: 'git@example.com:repo.git' },
          },
          workspaceId: 'local:project-1:branch:main',
        },
        '/repo',
        service
      )
    ).resolves.toBe('/repo');

    expect(getWorktree).toHaveBeenCalledWith('main', { includeProjectRoot: true });
    expect(service.checkoutExistingBranch).not.toHaveBeenCalled();
  });

  it('keeps first-time provisioning on the branch validation path', async () => {
    const getWorktree = vi.fn().mockResolvedValue('/worktrees/main');
    const service = worktreeServiceMock({ getWorktree });

    await expect(
      resolveTaskWorkDir(
        {
          taskBranch: 'main',
          sourceBranch: { type: 'local', branch: 'main' },
          workspaceId: undefined,
        },
        '/repo',
        service
      )
    ).resolves.toBe('/worktrees/main');

    expect(getWorktree).toHaveBeenCalledWith('main');
  });
});
