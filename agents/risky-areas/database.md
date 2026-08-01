# Risky Area: Database

## Main Files

- `src/main/db/schema.ts`
- `src/main/db/initialize.ts`
- `drizzle/`

## Rules

- never hand-edit numbered migrations
- never hand-edit `drizzle/meta/`
- use `pnpm exec drizzle-kit generate` for new migrations
- treat schema invariants and data migrations as high risk

## Current Behavior

- database path is resolved by main-process db path helpers
- `YODA_DB_FILE` overrides the default location
- database initialization happens in `src/main/db/initialize.ts`
- `workspace_terminals` stores project-root terminal identities separately from
  task terminals because it has no task foreign key; the tmux process remains
  the runtime source of truth after restart
