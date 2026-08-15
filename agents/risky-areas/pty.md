# Risky Area: PTY And Sessions

## Main Files

- `src/main/core/pty/` — `local-pty.ts`, `ssh2-pty.ts`, `pty.ts`, `pty-env.ts`, `pty-session-registry.ts`, `spawn-utils.ts`, `exit-signals.ts`, `controller.ts`
- `src/main/core/terminals/` — terminal lifecycle, local and SSH terminal providers
- `src/main/core/terminals/workspace-terminal-service.ts` — task-free project/global terminals, persisted project-terminal reattachment, and allowlisted runtime actions
- `src/main/core/conversations/impl/agent-event-classifiers/` — per-provider terminal output parsers
- `src/main/core/agent-hooks/` — hook server, event enrichment, OS notifications, hook config writer

## Core Risks

- PTY cleanup and exit handling
- resize behavior
- shell quoting and Windows command wrapping
- tmux lifecycle
- provider-specific resume/session behavior
- env passthrough safety

## Rules

- use the allowlisted env passthrough model in `src/main/core/pty/pty-env.ts`
- do not weaken quoting or spawn behavior casually
- validate both direct spawn and shell-wrapped spawn cases when changing PTY startup logic
- confirm renderer event flow if hook payload or notification behavior changes
- preserve the output contract: generation isolates respawns, sequence joins
  snapshot/live data exactly once, and xterm write ACKs release PTY backpressure
- renderer subscription snapshots contain terminal protocol only: use the
  committed PTY ring or a renderer-authored checkpoint, never transcript/history
  text; session history belongs to its dedicated UI
- keep the default renderer PTY warm set bounded; hidden xterms inside that
  window continue parsing while their off-screen DOM renderer is paused, and
  the oldest safe xterms checkpoint plus unsubscribe as the window advances;
  measured memory pressure or sustained hidden output may shrink it further
- a checkpoint-backed tmux transport detach releases only Yoda's current attach
  wrapper; it must not publish PTY/Agent exit or mark the conversation stopped.
  `transportAttached: false` remains a live, reattachable tmux session; only
  explicit stop/destroy or idle-session hibernation terminates the tmux session
- a dead PTY proves only that the transport died. For a tmux-backed session the
  provider CLI lives in the pane and outlives every attach wrapper, so classify
  every unexpected wrapper death (flow-control kill, client crash, SIGHUP)
  against tmux before reporting an Agent exit; a surviving pane keeps the
  run-state watcher, runtime status and headless `tmux send-keys` input path
- idle-session hibernation may terminate only detachable `idle`/`completed`
  sessions with zero renderer consumers; first reopen/input must transparently
  resume through the existing conversation registration epoch
- decode byte streams incrementally; never call `Buffer.toString('utf8')`
  independently on arbitrary SSH/network chunks
- keep replay buffers bounded by UTF-8 bytes without slicing inside a code point
- resize only the mounted active session, and update frontend/backend to the same
  dimension tuple; task-open staging must use `resizeForRenderer` with the exact
  live generation and keep the destination hidden on mismatch
- provider startup is single-flight per session; stop/delete/detach must
  invalidate an in-flight start before unregistering, and any stale or failed
  spawn must kill its own PTY without touching a newer generation
- project-root terminals follow the global tmux policy, persist outside the
  task-terminal table, and must participate in detach/terminate app shutdown
