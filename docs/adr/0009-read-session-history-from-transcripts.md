# ADR 0009: Read session history from transcripts, leave the PTY for live execution

## Status

Proposed on 2026-08-15. Evaluation only — no code has been written against it.

## Context

Opening an existing task costs ~3 s today, down from ~9 s. Nearly all of the
remaining cost is one thing: the renderer refuses to show the terminal until it
can prove that the frame on screen is the *restored conversation* rather than a
loading frame. Because no provider CLI publishes a "restore complete" signal, the
proof is assembled out of proxies:

- `FALLBACK_FIRST_FRAME_QUIET_MS` — wait for the terminal to go quiet. A streaming
  agent CLI never does on request, so the wait costs the provider's whole startup.
- `expectedCanonicalSurfaceAnchor` — take a text fragment from the **transcript on
  disk** and wait until it appears in the terminal buffer. Produced for `codex`
  only: `resolveConversationSurfaceAnchor` in `resumeConversation.ts` returns
  `unverifiable` for every other runtime, and `unverifiable` has no text fast path
  at all — it still requires an exact-generation, cursor-complete, parser-drained
  frame plus the bounded quiet fallback.

The second proxy is the tell. For `codex` we already read the transcript to decide
whether the terminal is trustworthy, then spend seconds waiting for the provider to
redraw, into a grid, content we had in hand before the wait began. For `claude`
there is no evidence at all, so every resume pays the full quiet fence. Either way
the fence is not a latency bug to be tuned — it is the cost of having chosen the
terminal as the history surface.

### What already exists

The transcript path is not greenfield:

| Piece | Location | State |
| --- | --- | --- |
| Structured block parser (Claude) | `src/main/core/conversations/claude-transcript.ts` | full parse of the whole file, no cache, no cursor |
| Structured block parser (Codex) | `src/main/core/conversations/codex-rollout-terminal-history.ts` | tail-bounded at 8 MiB, LRU of 3 rollouts |
| Block model | `MobileSessionTranscriptBlock` in `src/shared/mobile-api.ts` | roles user/assistant/tool/status, `agentPhase`, `toolStatus`, `toolCallId`, format markdown/code/plain |
| Grouping / render items | `src/shared/mobile-tool-transcript.ts` | adjacent tool calls collapse into one stable group |
| Interaction extraction | `src/shared/mobile-session-interaction.ts` | structured only for `AskUserQuestion` / `ExitPlanMode`, otherwise scrapes terminal text |
| Live change feed | `src/main/core/conversations/transcript-feed.ts` | ref-counted `fs.watch`, 250 ms debounce |
| Desktop transcript surface | `src/renderer/features/tasks/transcript-panel.tsx` | raw JSONL debug viewer (last 500 lines), not a reading surface |

So the mobile app already renders a structured conversation from the transcript,
while the desktop renders the provider's TUI. The desktop is the surface that
still has no reader.

### Two hard boundaries

1. **Provider coverage.** `RUNTIME_IDS` has 30 entries. Exactly two — `claude` and
   `codex` — have transcript parsers, and `HarnessRuntimeId` is typed to those two.
   For the other 28, the terminal *is* the only session record. Any plan that
   assumes transcript history is a replacement is wrong for 28/30 of the product.
2. **The TUI owns interaction.** Permission prompts, slash-command pickers, model
   selection, plan approval and the provider's own banners exist only in the
   terminal; they are not transcript events. Mobile works around this by scraping
   the terminal buffer (`parseTerminalInteraction`). Input therefore cannot move
   off the PTY, and neither can approvals.

### Measured cost of the data layer

Read + parse every line, then the same file via a tail read (`node`, this machine):

| File | Size | Full read + parse | Last 256 KiB | Last 1 MiB |
| --- | --- | --- | --- | --- |
| Claude session JSONL (6 961 lines) | 14.3 MB | 102 ms (29 read / 73 parse) | 6 ms | 3 ms |
| Codex rollout JSONL (19 056 lines) | 94.6 MB | 1 064 ms (263 / 802) | 21 ms | 5 ms |

Two conclusions. First, reading history is ~three orders of magnitude cheaper than
the fence it would replace — the data layer is not the problem and pagination is
not needed for *latency*. Second, pagination is still needed for *bounding*:
`loadClaudeTranscript` reads and re-parses the entire file on every invalidation,
and `transcript-feed` invalidates up to 4×/s during a live turn. On a 14 MB
transcript that is ~40 % of a core, spent re-deriving unchanged prefix. Codex
escapes this only because it caps its tail at 8 MiB.

## Options

### A. Keep tuning the fence

Lower the quiet window, add more proxies (cursor shape, DEC 2026 pairing, anchor
segments). Cheap per step, and each step is a guess about a CLI's redraw
behaviour that a provider release can invalidate. A window short enough to be fast
is also short enough to publish a loading frame — the two failure modes are the
same knob. Rejected as a direction, though the existing bounds must stay.

### B. Transcript renders history, PTY renders live (recommended)

Task open paints a Yoda-native transcript view from the last N blocks. The PTY
still attaches, still owns input, approvals and live output — but it no longer has
to prove it holds *history*, only that it is attached to the live tail. The
canonical surface-anchor fence and the quiet fence disappear from the open path;
what remains is route commit, a tail read (single-digit ms) and an xterm mount.

Applies to `claude` and `codex`. The other 28 runtimes keep today's path
unchanged, fence included.

### C. Transcript-native UI, PTY headless

Yoda renders the whole conversation itself; the terminal becomes an implementation
detail the user never sees. This is the Harness/Codex-app shape, and it is where
capabilities like per-message anchoring, branch/fork-at-message and search
ultimately live. It also requires re-implementing every interaction the TUI owns,
per provider, and re-implementing them again on each provider release. Out of
scope as a single step; B is a prerequisite for it either way.

## Decision (proposed)

Adopt B, staged. Each stage is independently shippable and independently
revertable.

**Stage 1 — bound and cache the readers.** Give both parsers an offset cursor:
parse only bytes appended since the last read, keep the block list per
`(path, size, mtime)`, and cap the retained head. Pure main-process work, no UI.
This removes the 4×/s full re-parse that mobile pays today.
*Accept:* a live Claude turn on a 14 MB transcript re-parses only the appended
tail; `claude-transcript.test.ts` covers an append, a truncation and a rewrite.

**Stage 2 — desktop transcript view.** Render `MobileSessionTranscriptBlock`s in
the task view, reusing `groupAdjacentMobileToolBlocks` and the existing block
model rather than inventing a desktop-only shape. Windowed list, newest-first
load, "load earlier" upward. This is the piece the desktop is missing today.
*Accept:* opening a task with a 14 MB transcript paints history without waiting on
any terminal fence; a runtime without a parser is unaffected.

**Stage 3 — demote the fence for parser-backed runtimes.** When the transcript
view owns history, the frame loop's requirement drops to "attached to live tail".
For `codex` that means retiring the surface-anchor fence; for `claude` it means
retiring the `unverifiable` quiet fallback, which is the larger win since it has
no fast path today. Both fences stay in place for the other 28 runtimes.
*Accept:* measured task-open trajectory for a `claude` task shows no
`frame-canonical-wait` / `frame-quiet-wait` step, and total open lands under 1 s
(the target the 3 s figure was a concession against).

**Stage 4 — interaction parity.** Approvals and pickers stay in the terminal, but
the transcript view must not hide the fact that the terminal is asking for
something. Surface `pendingInteraction` inline and focus the PTY on answer.
*Accept:* a permission prompt raised mid-turn is visible and answerable without
the user knowing which surface produced it.

## Consequences

- The open path stops depending on provider redraw behaviour for the two runtimes
  that matter most. It keeps depending on it for the other 28 — the fence code and
  its bounds must stay maintained, not be treated as legacy.
- Two history surfaces exist during stages 2–3 (terminal scrollback and the
  transcript view). Per `agents/conventions/reuse.md` the same session must not
  read differently in the two; the transcript view has to be the one both the task
  view and the archived-session modal use.
- Transcript truth lags the terminal by the provider's file-write cadence plus the
  250 ms watch debounce. Acceptable for history, not for the live tail — which is
  exactly why the PTY stays.
- Cross-provider divergence moves from the fence into the parsers, where it is at
  least testable against a fixture file instead of against a live CLI's timing.

## Open questions

1. **Does the transcript view replace the terminal in the task view, or sit beside
   it?** Replacing it is the only version that actually removes the open cost;
   sitting beside it doubles the surfaces and keeps the fence alive.
2. **What happens for the 28 runtimes without parsers?** Ship the split experience
   (fast, structured for two; terminal-only for the rest), or hold stage 3 until a
   generic parser exists? A generic one may be impossible — most of those CLIs
   write no transcript at all.
3. **Is stage 1 worth doing alone?** It is the only stage that pays off with no UI
   work, and it fixes a live mobile cost. It is also the stage most likely to be
   the whole win if stage 2 slips.

## References

- `src/renderer/lib/pty/pty.ts` — `FALLBACK_FIRST_FRAME_QUIET_MS` and the fence
  bounds around it; comments there record why the proxy is defective.
- `agents/risky-areas/pty.md` — the fence's known-defect note and how to read the
  task-open trajectory.
- Blog write-up of the measurement that produced this ADR:
  `/blog/yoda-task-open-silence-fence`.
