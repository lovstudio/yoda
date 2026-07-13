import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Remote } from '@shared/git';
import { ok } from '@shared/result';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import type { ProjectSettingsProvider } from '../settings/provider';
import { LocalWorktreeHost } from './hosts/local-worktree-host';
import type { WorktreeHost } from './hosts/worktree-host';
import { WorktreeService } from './worktree-service';

async function git(
  args: string[],
  opts: { cwd: string }
): Promise<{ stdout: string; stderr: string }> {
  const ctx = new LocalExecutionContext({ root: opts.cwd });
  return ctx.exec('git', args);
}

async function initRepo(dir: string): Promise<void> {
  await git(['init'], { cwd: dir });
  await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: dir });
  await git(['config', 'user.email', 'test@test.com'], { cwd: dir });
  await git(['config', 'user.name', 'Test'], { cwd: dir });
  await git(['commit', '--allow-empty', '-m', 'init'], { cwd: dir });
}

function makeSettings(preservePatterns: string[] = []): ProjectSettingsProvider {
  return {
    get: async () => ({ preservePatterns }),
    update: async () => ok(),
    patch: async () => ok(),
    ensure: async () => {},
    getDefaultWorktreeDirectory: async () => '',
    getWorktreeDirectory: async () => '',
    getDefaultBranch: async () => 'main',
    getRemote: async () => 'origin',
  } as ProjectSettingsProvider;
}

const originRemote = (url = 'ssh://example.com/repo.git'): Remote => ({ name: 'origin', url });

function overrideRemoveAbsolute(
  base: WorktreeHost,
  removeAbsolute: WorktreeHost['removeAbsolute']
): WorktreeHost {
  return {
    existsAbsolute: base.existsAbsolute.bind(base),
    mkdirAbsolute: base.mkdirAbsolute.bind(base),
    removeAbsolute,
    realPathAbsolute: base.realPathAbsolute.bind(base),
    globAbsolute: base.globAbsolute.bind(base),
    readFileAbsolute: base.readFileAbsolute.bind(base),
    copyFileAbsolute: base.copyFileAbsolute.bind(base),
    statAbsolute: base.statAbsolute.bind(base),
  };
}

describe('WorktreeService', () => {
  let repoDir: string;
  let poolDir: string;
  let host: WorktreeHost;

  beforeEach(async () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-repo-'));
    poolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-pool-'));
    await initRepo(repoDir);
    host = await LocalWorktreeHost.create({
      allowedRoots: [repoDir, poolDir],
    });
  });

  // Windows briefly locks git worktree/index files on teardown; retry rmSync so
  // afterEach cleanup does not fail with EPERM. The first attempt succeeds on POSIX.
  function rmSyncRetry(target: string): void {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        fs.rmSync(target, { recursive: true, force: true });
        return;
      } catch {
        const end = Date.now() + 25 * (attempt + 1);
        while (Date.now() < end) {
          /* backoff before retrying */
        }
      }
    }
  }

  afterEach(() => {
    rmSyncRetry(repoDir);
    rmSyncRetry(poolDir);
  });

  function makeService(
    overrides: Partial<{
      worktreePoolPath: string;
      repoPath: string;
      projectSettings: ProjectSettingsProvider;
    }> = {}
  ): WorktreeService {
    const repoPath = overrides.repoPath ?? repoDir;
    return new WorktreeService({
      worktreePoolPath: overrides.worktreePoolPath ?? poolDir,
      repoPath,
      ctx: new LocalExecutionContext({ root: repoPath }),
      host,
      projectSettings: overrides.projectSettings ?? makeSettings(),
    });
  }

  describe('checkoutBranchWorktree', () => {
    it('creates a worktree from an existing local source branch', async () => {
      await git(['branch', 'task/local-checkout'], { cwd: repoDir });
      const svc = makeService();

      const result = await svc.checkoutBranchWorktree(
        { type: 'local', branch: 'main' },
        'task/local-checkout'
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected success');
      expect(result.data).toBe(path.join(poolDir, 'local-checkout'));
      expect(fs.existsSync(result.data)).toBe(true);
    });

    it('falls back to the flattened branch name when the leaf directory is taken', async () => {
      await git(['branch', 'task-a/same-leaf'], { cwd: repoDir });
      await git(['branch', 'task-b/same-leaf'], { cwd: repoDir });
      const svc = makeService();

      const first = await svc.checkoutBranchWorktree(
        { type: 'local', branch: 'main' },
        'task-a/same-leaf'
      );
      expect(first.success).toBe(true);
      if (!first.success) throw new Error('expected success');
      expect(first.data).toBe(path.join(poolDir, 'same-leaf'));

      const second = await svc.checkoutBranchWorktree(
        { type: 'local', branch: 'main' },
        'task-b/same-leaf'
      );
      expect(second.success).toBe(true);
      if (!second.success) throw new Error('expected success');
      expect(second.data).toBe(path.join(poolDir, 'task-b-same-leaf'));

      // Both resolve back to their own paths by branch name.
      expect(await svc.getWorktree('task-a/same-leaf')).toBe(fs.realpathSync(first.data));
      expect(await svc.getWorktree('task-b/same-leaf')).toBe(fs.realpathSync(second.data));
    });

    it('uses the flattened branch path when a stale leaf directory cannot be removed', async () => {
      await git(['branch', 'task/stale-leaf'], { cwd: repoDir });
      const stalePath = path.join(poolDir, 'stale-leaf');
      fs.mkdirSync(path.join(stalePath, 'node_modules', 'electron'), { recursive: true });
      const realHost = host;
      host = overrideRemoveAbsolute(realHost, async () => ({
        success: false,
        error: 'busy',
      }));
      const svc = makeService();

      const result = await svc.checkoutBranchWorktree(
        { type: 'local', branch: 'main' },
        'task/stale-leaf'
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected success');
      expect(result.data).toBe(path.join(poolDir, 'task-stale-leaf'));
      expect(fs.existsSync(path.join(result.data, '.git'))).toBe(true);
      expect(fs.existsSync(stalePath)).toBe(true);
    });

    it('creates a worktree from a remote source branch when branch is not local', async () => {
      const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-remote-'));
      try {
        await git(['init', '--bare'], { cwd: remoteDir });
        await git(['remote', 'add', 'origin', remoteDir], { cwd: repoDir });
        await git(['branch', 'feature/remote-base'], { cwd: repoDir });
        await git(['push', '-u', 'origin', 'feature/remote-base'], { cwd: repoDir });
        await git(['branch', '-D', 'feature/remote-base'], { cwd: repoDir });

        const svc = makeService();
        const result = await svc.checkoutBranchWorktree(
          { type: 'remote', branch: 'feature/remote-base', remote: originRemote(remoteDir) },
          'task/from-remote'
        );

        expect(result.success).toBe(true);
        if (!result.success) throw new Error('expected success');
        expect(fs.existsSync(result.data)).toBe(true);

        const { stdout } = await git(['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: result.data,
        });
        expect(stdout.trim()).toBe('task/from-remote');
      } finally {
        fs.rmSync(remoteDir, { recursive: true, force: true });
      }
    });

    it('returns existing checked out path when branch is already checked out elsewhere', async () => {
      await git(['branch', 'feature/already-open'], { cwd: repoDir });
      const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-external-'));
      const externalPath = path.join(externalDir, 'feature-already-open');
      await git(['worktree', 'add', externalPath, 'feature/already-open'], {
        cwd: repoDir,
      });

      const svc = makeService();
      const result = await svc.checkoutBranchWorktree(
        { type: 'local', branch: 'main' },
        'feature/already-open'
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected success');
      // Yoda may return forward-slash worktree paths even on Windows; normalize
      // both sides before comparing so the assert is separator-agnostic.
      expect(path.normalize(result.data)).toBe(path.normalize(fs.realpathSync(externalPath)));

      fs.rmSync(externalDir, { recursive: true, force: true });
    });

    it('returns branch-not-found when source branch does not exist', async () => {
      const svc = makeService();

      const result = await svc.checkoutBranchWorktree(
        { type: 'local', branch: 'does-not-exist' },
        'task/no-source'
      );

      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      expect(result.error.type).toBe('branch-not-found');
    });

    it('copies preserved files into the created worktree', async () => {
      fs.writeFileSync(path.join(repoDir, '.env'), 'SECRET=abc');
      await git(['branch', 'task/env-test'], { cwd: repoDir });
      const svc = makeService({ projectSettings: makeSettings(['.env']) });

      const result = await svc.checkoutBranchWorktree(
        { type: 'local', branch: 'main' },
        'task/env-test'
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected success');
      expect(fs.readFileSync(path.join(result.data, '.env'), 'utf8')).toBe('SECRET=abc');
    });
  });

  describe('checkoutExistingBranch', () => {
    it('returns existing checked out path when branch is already checked out elsewhere', async () => {
      await git(['branch', 'feature/already-open-existing'], { cwd: repoDir });
      const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-external-'));
      const externalPath = path.join(externalDir, 'feature-already-open-existing');
      await git(['worktree', 'add', externalPath, 'feature/already-open-existing'], {
        cwd: repoDir,
      });

      const svc = makeService();
      const result = await svc.checkoutExistingBranch('feature/already-open-existing');

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected success');
      // Yoda may return forward-slash worktree paths even on Windows; normalize
      // both sides before comparing so the assert is separator-agnostic.
      expect(path.normalize(result.data)).toBe(path.normalize(fs.realpathSync(externalPath)));

      fs.rmSync(externalDir, { recursive: true, force: true });
    });

    it('creates local branch from remote when needed', async () => {
      const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-remote-'));
      try {
        await git(['init', '--bare'], { cwd: remoteDir });
        await git(['remote', 'add', 'origin', remoteDir], { cwd: repoDir });
        await git(['branch', 'feature/from-remote'], { cwd: repoDir });
        await git(['push', '-u', 'origin', 'feature/from-remote'], { cwd: repoDir });
        await git(['branch', '-D', 'feature/from-remote'], { cwd: repoDir });

        const svc = makeService();
        const result = await svc.checkoutExistingBranch('feature/from-remote');

        expect(result.success).toBe(true);
        if (!result.success) throw new Error('expected success');
        expect(fs.existsSync(result.data)).toBe(true);
      } finally {
        fs.rmSync(remoteDir, { recursive: true, force: true });
      }
    });

    it('uses the explicitly selected remote source branch', async () => {
      const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-upstream-'));
      try {
        await git(['init', '--bare'], { cwd: remoteDir });
        await git(['remote', 'add', 'upstream', remoteDir], { cwd: repoDir });
        await git(['branch', 'feature/from-upstream'], { cwd: repoDir });
        await git(['push', '-u', 'upstream', 'feature/from-upstream'], { cwd: repoDir });
        await git(['branch', '-D', 'feature/from-upstream'], { cwd: repoDir });

        const svc = makeService();
        const result = await svc.checkoutExistingBranch('feature/from-upstream', {
          type: 'remote',
          branch: 'feature/from-upstream',
          remote: { name: 'upstream', url: remoteDir },
        });

        expect(result.success).toBe(true);
        if (!result.success) throw new Error('expected success');
        expect(fs.existsSync(result.data)).toBe(true);
      } finally {
        fs.rmSync(remoteDir, { recursive: true, force: true });
      }
    });

    it('fast-forwards an existing local branch from the explicit remote source', async () => {
      const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-ff-'));
      try {
        await git(['init', '--bare'], { cwd: remoteDir });
        await git(['remote', 'add', 'origin', remoteDir], { cwd: repoDir });
        await git(['branch', 'feature/fast-forward'], { cwd: repoDir });
        await git(['push', '-u', 'origin', 'feature/fast-forward'], { cwd: repoDir });
        await git(['checkout', 'feature/fast-forward'], { cwd: repoDir });
        await git(['commit', '--allow-empty', '-m', 'remote update'], { cwd: repoDir });
        await git(['push', 'origin', 'feature/fast-forward'], { cwd: repoDir });
        const remoteHead = await git(['rev-parse', 'HEAD'], { cwd: repoDir });
        await git(['checkout', 'main'], { cwd: repoDir });
        await git(['branch', '--force', 'feature/fast-forward', 'main'], { cwd: repoDir });

        const svc = makeService();
        const result = await svc.checkoutExistingBranch('feature/fast-forward', {
          type: 'remote',
          branch: 'feature/fast-forward',
          remote: originRemote(remoteDir),
        });

        expect(result.success).toBe(true);
        if (!result.success) throw new Error('expected success');
        const localHead = await git(['rev-parse', 'feature/fast-forward'], { cwd: repoDir });
        expect(localHead.stdout.trim()).toBe(remoteHead.stdout.trim());
        const worktreeHead = await git(['rev-parse', 'HEAD'], { cwd: result.data });
        expect(worktreeHead.stdout.trim()).toBe(remoteHead.stdout.trim());
      } finally {
        fs.rmSync(remoteDir, { recursive: true, force: true });
      }
    });

    it('fast-forwards a checked out branch when only untracked files are present', async () => {
      const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-ff-untracked-'));
      try {
        await git(['init', '--bare'], { cwd: remoteDir });
        await git(['remote', 'add', 'origin', remoteDir], { cwd: repoDir });
        await git(['push', '-u', 'origin', 'main'], { cwd: repoDir });
        await git(['commit', '--allow-empty', '-m', 'remote update'], { cwd: repoDir });
        await git(['push', 'origin', 'main'], { cwd: repoDir });
        const remoteHead = await git(['rev-parse', 'HEAD'], { cwd: repoDir });
        await git(['reset', '--hard', 'HEAD~1'], { cwd: repoDir });
        fs.mkdirSync(path.join(repoDir, '.worktrees'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, '.worktrees', 'local-task'), 'local metadata');

        const svc = makeService();
        const result = await svc.checkoutExistingBranch('main', {
          type: 'remote',
          branch: 'main',
          remote: originRemote(remoteDir),
        });

        expect(result.success).toBe(true);
        if (!result.success) throw new Error('expected success');
        expect(result.data).toBe(fs.realpathSync(repoDir));
        const localHead = await git(['rev-parse', 'main'], { cwd: repoDir });
        expect(localHead.stdout.trim()).toBe(remoteHead.stdout.trim());
        expect(fs.existsSync(path.join(repoDir, '.worktrees', 'local-task'))).toBe(true);
      } finally {
        fs.rmSync(remoteDir, { recursive: true, force: true });
      }
    });

    it('does not fast-forward a checked out branch with tracked changes', async () => {
      const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-ff-tracked-'));
      try {
        await git(['init', '--bare'], { cwd: remoteDir });
        await git(['remote', 'add', 'origin', remoteDir], { cwd: repoDir });
        fs.writeFileSync(path.join(repoDir, 'tracked.txt'), 'base');
        await git(['add', 'tracked.txt'], { cwd: repoDir });
        await git(['commit', '-m', 'add tracked file'], { cwd: repoDir });
        await git(['push', '-u', 'origin', 'main'], { cwd: repoDir });
        await git(['commit', '--allow-empty', '-m', 'remote update'], { cwd: repoDir });
        await git(['push', 'origin', 'main'], { cwd: repoDir });
        await git(['reset', '--hard', 'HEAD~1'], { cwd: repoDir });
        fs.writeFileSync(path.join(repoDir, 'tracked.txt'), 'local edit');

        const svc = makeService();
        const result = await svc.checkoutExistingBranch('main', {
          type: 'remote',
          branch: 'main',
          remote: originRemote(remoteDir),
        });

        expect(result.success).toBe(false);
        if (result.success) throw new Error('expected failure');
        expect(result.error.type).toBe('worktree-setup-failed');
      } finally {
        fs.rmSync(remoteDir, { recursive: true, force: true });
      }
    });
  });
});
