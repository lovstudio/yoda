# Feature development workflow

## Problem

Feature work in Yoda can already start an agent, write a spec, run an implementation-review loop, or launch a reusable agent team. Those modes are separate islands. A problem statement does not carry one durable contract through product design, implementation, verification, user documentation, and launch documentation, so later agents must reconstruct context and a green task can still lack tests or docs.

The product job is: give Yoda one problem and receive a traceable, repository-native delivery package whose decisions, code, checks, feature docs, and PR/SEO copy agree with one another.

## Goals

- Make the complete feature lifecycle a first-class development paradigm, not a checklist pasted into one prompt.
- Preserve every stage hand-off and its evidence across app restarts.
- Keep stages sequential, while allowing an explicit validation-to-engineering repair loop.
- Reuse the existing task worktree, Team Room, member sessions, and `team-at` transport.
- Make the current gate, owner, blocker, and latest evidence visible without opening every session.
- Support both a new problem entered on Home and branch/Issue task creation.

## Non-goals

- Replace task lifecycle status or the project Kanban.
- Add a second workflow database or a schema migration.
- Infer success from an agent process becoming idle.
- Automatically push, merge, publish, or create external resources without authorization.
- Force every repository into one documentation directory; project conventions remain authoritative.

## Workflow

The workflow is a built-in `Feature` Agent Team with one coordinating lead and five workers. All members share the task worktree and advance through six gates:

1. Problem definition — target user, outcome, non-goals, constraints, success signal, and feature slug.
2. Product design — PRD, user flow, UI/UX states, accessibility, edge cases, and testable acceptance criteria.
3. Implementation — production code, focused automated tests, and technical decisions.
4. Validation — independent diff review and exact repository-required checks. A failure returns to implementation and invalidates affected downstream gates.
5. Feature documentation — verified user behavior, configuration, examples, limitations, and troubleshooting.
6. PR and SEO documentation — PR title/body, changelog/release copy, and SEO/discovery copy when applicable.

The Feature Lead delegates one stage at a time. Workers report a durable marker such as `[FEATURE:validation:pass]` or `[FEATURE:validation:blocked]` together with artifact paths and evidence. The renderer reduces those persisted hand-offs in order, so it can restore the same gate state after a reload. A later-stage marker cannot skip a missing prerequisite. Re-passing an earlier stage invalidates downstream evidence.

## Information architecture and interaction

Feature appears in the Home development-paradigm dialog under `Workflow`, even though it is implemented on the multi-agent substrate. It sits beside Standard, Review, and Spec because users choose it by delivery method, not by team topology.

The task-creation modal keeps source and execution orthogonal:

- Source: branch, Issue, or pull request.
- Execution: Standard task or Feature loop (available for branch and Issue).

Selecting Feature replaces the single-agent picker with a six-stage preview and a problem brief. The create action first provisions the task/worktree, then seeds the Feature Team Room. A failed room start reports that the task exists rather than pretending the whole creation failed.

Inside a Feature room, a numbered `01–06` hand-off rail sits between the room header and conversation. Each stage shows a text status as well as color, opens its responsible member detail (with session access), and exposes the latest accepted hand-off evidence. Layout uses two columns at narrow widths, three at medium widths, and a connected six-stage spine at wide widths; it never requires horizontal scrolling.

## States and failure behavior

- `Waiting`: a prerequisite gate has not passed.
- `In progress`: the first unpassed gate or a legitimate rework session is running.
- `Gate passed`: an ordered, persisted pass marker exists.
- `Blocked`: a persisted blocker exists, or the current member is awaiting input or errored.

An idle/finished runtime does not pass a gate. Malformed markers remain visible in chat but do not advance the rail. Out-of-order markers are ignored by the reducer. When an earlier stage is passed again, all later stages return to waiting until they are re-verified.

## Accessibility and responsive behavior

- The rail is an ordered list and the current stage uses `aria-current="step"`.
- Progress changes are announced through a polite live region.
- Every stage has a textual status and a keyboard-focus ring; status is never color-only.
- Stage controls remain visible without hover and wrap into a grid instead of overflowing.
- The UI introduces no motion dependency; reduced-motion users lose no information.

## Acceptance criteria

- Feature is selectable from Home as a Workflow entry without changing existing team-mode defaults.
- Branch and Issue task creation can start Feature without creating an irrelevant initial single-agent conversation.
- The room is stored with the `feature-workflow` preset and contains the ordered Feature team.
- A problem prompt starts at stage 01 and the Feature Lead can advance only by emitting the required ordered hand-offs.
- PASS, BLOCKED, out-of-order, validation failure, engineering rework, and upstream invalidation reduce deterministically from room messages.
- The rail survives reloads because it uses persisted messages, not component state.
- Existing Standard, Spec, Review, Startup, custom teams, and pull-request task creation continue to behave as before.
- Home, Create Task, room-intro, and hand-off-rail product copy is available in English and Simplified Chinese; protocol transcript lines remain repository-neutral English.
