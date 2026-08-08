# Main Process

## Structure

The main process is organized into domain modules under `src/main/core/`. Each domain typically has a `controller.ts` (RPC handlers) and service/implementation files.

## Domain Modules (`src/main/core/`)

- **account** — Yoda account service, credential store, provider token registry
- **agent-hooks** — HTTP hook server for agent callbacks, event enrichment, OS notifications, hook config writer (Claude/Codex)
- **app** — App lifecycle service and controller
- **conversations** — Conversation CRUD, session start, agent event classifiers (per-provider terminal output parsers)
- **dependencies** — CLI agent detection, probing, dependency management
- **editor** — Editor buffer service for Monaco integration
- **extensions** — Yoda Marketplace catalog, installation state, permissions,
  and isolated background-service runtimes
- **fs** — Filesystem operations with provider pattern (`local-fs.ts`, `ssh-fs.ts`)
- **git** — Git operations (`git-service.ts`, `git-repo-utils.ts`, `detectGitInfo.ts`)
- **github** — GitHub auth, PRs, issues, repos (via `gh` CLI)
- **issues** — Issue provider RPC plus the opt-in Issue worker. The worker uses
  persisted per-project settings, single-flight polling, local capacity checks,
  issue-link deduplication, and isolated worktree tasks to feed unattended
  Agents; completed runs move to review and immediately free a queue slot.
- **jira** — Jira integration
- **linear** — Linear integration
- **maas** — MaaS connections, encrypted credentials, Client bindings, and the
  optional Marketplace-delivered MaaS Gateway integration
- **mcp** — MCP service, adapters, config IO, catalog
- **projects** — Project management with provider pattern (`local-project-provider.ts`), worktree service, project settings, CRUD operations
- **pty** — PTY lifecycle (`local-pty.ts`, `ssh2-pty.ts`), session registry, env setup, spawn utilities
- **repository** — Repository controller
- **settings** — App settings service and schema, provider settings (separate controller)
- **shared** — Shared utilities (OAuth flow)
- **skills** — Skills service and controller
- **ssh** — SSH connection management, credentials, config parsing, client proxy
- **team-rooms** — Agent Room persistence and session routing, pluggable process/message/file/GitHub
  communication, per-member observation snapshots, and active-room GitHub polling
- **tasks** — Task CRUD (create, delete, archive, restore, provision)
- **terminals** — Terminal lifecycle with provider pattern (`local-terminal-provider.ts`, `ssh-terminal-provider.ts`), lifecycle scripts
- **terminals/workspace-terminal-service** — Task-free project/global terminals backed by canonical terminal providers; project terminals persist independently from task terminals, reattach through tmux, and share the app quit decision with Agent sessions
- **updates** — Auto-update service

## Other Main Process Areas

- `src/main/app/` — Menu, protocol handler, window creation
- `src/main/lib/` — Logger, telemetry, events, result type, updater error
- `src/main/db/` — Database schema and initialization
- `src/main/utils/` — Shell environment, shell escaping, child process env, external links
- `src/main/core/agent-hooks/` — Hook server, event enrichment, OS notifications, hook config writer for Claude/Codex

Agent Rooms use one Coordinator-led, durable assignment protocol. Control-only hand-offs are
persisted even when they are hidden from chat; process/session, room, shared-file, and GitHub choices
describe the work record rather than changing delivery semantics. `syncToRoom` controls presentation
only. See `docs/adr/0007-coordinator-led-agent-room-orchestration.md`.

## IPC / RPC Structure

- All domain controllers are assembled into a typed RPC router in `src/main/rpc.ts`.
- RPC primitives live in `src/shared/ipc/rpc.ts` (`createRPCRouter`, `createRPCController`, `createRPCClient`).
- Event primitives live in `src/shared/ipc/events.ts`.
- A small number of manual IPC handlers remain in `electron-api.d.ts` for methods requiring `event.sender` (PTY start/input/resize/kill, fsList, openIn).

## When Editing Here

- Check `agents/conventions/main-patterns.md` for controller, service, Result type, and event patterns.
- Check `agents/conventions/ipc.md` for the RPC controller pattern and typing rules.
- Check `agents/risky-areas/pty.md` before touching PTY or provider spawn behavior.
- Check `agents/risky-areas/database.md` before changing persistence or migrations.
