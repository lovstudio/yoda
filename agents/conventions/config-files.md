# Config Files And Repo Rules

## Key Files

- `package.json`
- `electron.vite.config.ts`
- `vitest.config.ts`
- `tsconfig.json`
- `drizzle.config.ts`
- `.yoda.json`
- `.nvmrc`
- `.husky/`
- `.github/workflows/`
- `flake.nix`

## Repo Rules

- avoid editing `dist/`, `release/`, and `build/` unless the task is explicitly about packaging or signing
- the landing page in `docs/` is separate from the Electron renderer; public docs content lives outside this repo (`agents/workflows/docs-site.md`)
- update the narrowest relevant page in `agents/` instead of growing `AGENTS.md`
