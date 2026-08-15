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

## The First-Frame Silence Fence Is A Known Defect

`FALLBACK_FIRST_FRAME_QUIET_MS` in `src/renderer/lib/pty/pty.ts` uses terminal
silence as a proxy for "the provider finished restoring the conversation". A
streaming agent CLI never satisfies it on request — spinner, startup log and
token stream all restart the window — so the fence costs the provider's whole
startup, not its nominal 700 ms. Roughly six of the nine seconds of a cold task
open were spent here.

- do not treat the fence as tunable: a window short enough to be fast is also
  short enough to reveal a loading frame. Every bound around it
  (`CANONICAL_QUIET_HOLD_BUDGET_MS`, `CANONICAL_STALL_RESYNC_MS`,
  `CANONICAL_FENCE_PARK_FLOOR_MS`) contains the unboundedness; none of them make
  the proxy correct
- the correct fixes are an explicit provider readiness signal (a final-frame /
  restore-complete marker the fence can wait on) or reading history from the
  transcript and leaving the PTY responsible for live output only
- never let a wait's own bound sit at the cost of a measured healthy open — an
  attempt that expires just short of committing pays for the whole attempt twice

## Reading The Task-Open Trajectory

`src/renderer/features/tasks/task-open-trajectory-lanes.ts` splits marks into six
lanes by producer (`ui`/`frame`/`open` in the renderer, `session`/`client`/`pty`
in main), so dead air across all lanes reads as a handoff instead of hiding
inside one slow mark. What to look at first:

- `repeats` — a wait entered once and a wait entered nine times are different
  diagnoses. High repeats means something kept invalidating the condition, and
  the interval that looks silent is actually a spin
- `sinceOutputMs` — how long since the last byte. Large while a fence is waiting
  means the provider already stopped and the fence is waiting on nothing
- `heldMs` — how long a complete frame has been kept off screen. This is the
  user-visible cost of refusing a frame we already have
- `cursorComplete` / `anchorKind` / `anchorMatched` — which condition refused the
  frame. "main had no transcript evidence" and "the evidence never appeared on
  screen" have opposite fixes and are otherwise the same mark
- gap `kind` — `handoff` crosses lanes (someone finished, someone else was late
  to react), `stall` stays inside one lane (that lane was late to produce)

Instrumentation can blind itself: a mark emitted after the trace closes is
dropped, so a missing paint mark may mean ordering, not a missing paint.
