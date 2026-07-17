export type ListedWorktree = {
  path: string;
  branch: string | null;
};

export function parseWorktreePorcelain(output: string): ListedWorktree[] {
  const worktrees: ListedWorktree[] = [];
  for (const block of output.trim().split(/\n\s*\n/)) {
    const worktreePath = /^worktree (.+)$/m.exec(block)?.[1];
    if (!worktreePath) continue;
    const branchRef = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? null;
    worktrees.push({ path: worktreePath, branch: branchRef });
  }
  return worktrees;
}
