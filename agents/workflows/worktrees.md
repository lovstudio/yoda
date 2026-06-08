# Worktrees

## Main Files

- `src/main/core/projects/worktrees/worktree-service.ts`
- `src/main/core/projects/project-manager.ts`
- `src/main/core/terminals/runLifecycleScript.ts`
- `.yoda.json`

## Current Behavior

- task worktrees are created under the project's DB-backed worktree directory setting
- branch prefix defaults to `yoda` and is configurable in app settings
- selected gitignored files are preserved into worktrees
- worktree creation is managed by the project provider pattern

## `.yoda.json`

`.yoda.json` stores optional shareable project settings. Supported runtime keys:

- `preservePatterns`
- `scripts.setup`
- `scripts.run`
- `scripts.teardown`
- `shellSetup`

Base project settings are DB-backed Project Settings, not runtime `.yoda.json` keys:

- `worktreeDirectory`
- `defaultBranch`
- `remote`
- `workspaceProvider`

## Rules

- do not hardcode worktree paths; use service helpers
- use lifecycle config for repo-specific bootstrap and teardown behavior
- `shellSetup` runs inside each PTY before the interactive shell starts
- tmux wrapping is controlled by the global task setting and affects PTY lifecycle behavior.
- `preservePatterns` never copies tracked files or `.yoda.json`
