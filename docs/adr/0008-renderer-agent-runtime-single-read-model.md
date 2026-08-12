# ADR 0008: Use one renderer read model for Agent session runtime state

## Status

Accepted on 2026-08-12.

## Context

An Agent session has two different kinds of state:

1. **Agent runtime state** — whether a turn is working, waiting for input, completed, or failed.
2. **Task lifecycle state** — whether the task is todo, in progress, in review, done, or cancelled.

They have different authorities and must not share a store or event channel.

The Agent runtime path previously exposed two renderer write/read paths. A mounted
`ConversationStore` applied local optimistic changes immediately, while the mount-independent
`appState.agentRuntime` mirror updated only after the renderer event crossed into the main process
and returned. Tabs, sidebars, session panels, and action guards could therefore render different
states for the same conversation. Runtime hydration could also return after a newer local or
authoritative transition and overwrite it.

Task lifecycle updates had a related but separate race: a failed optimistic RPC could roll back a
status after a newer `task:status-updated` event had already changed the task.

## Decision

The main-process `AgentSessionRuntimeStore` remains the canonical runtime state reducer. The
renderer `AgentRuntimeStore` is the mount-independent runtime read model for all live and
attention-worthy session status.

Renderer rules:

- Runtime commands may publish a renderer-local preview so the read model updates in the same
  event turn; this preview is not confirmation and does not replace the main-process event.
- `ConversationStore` owns conversation metadata, PTY lifecycle, notification context, and a
  compatibility fallback while runtime hydration is incomplete. It is not the live status source
  for rendered surfaces.
- Mounted surfaces read through shared selectors that prefer `appState.agentRuntime` and fall back
  to the mounted store only when the mirror has no entry.
- Conversation runtime hydration captures a per-conversation revision before the RPC and skips a
  response if a newer local or event-driven transition was observed.
- Task lifecycle status keeps its own `taskStatusUpdatedChannel`. Optimistic rollback is guarded by
  a mutation id and an authoritative-event revision, so a late failure cannot resurrect stale data.
- Agent Room member status and React Query data remain separate projections; neither is used as a
  substitute for the Agent session runtime read model.

```text
Agent / PTY
    |
    v
main AgentSessionRuntimeStore  -- authoritative event -->  renderer AgentRuntimeStore
    ^                                                     |
    |                                                     v
renderer command -- local preview --------------------> shared status selectors -> UI
```

## Consequences

- A working or awaiting-input transition is visible to tabs, sidebars, session panels, and action
  guards without waiting for an IPC round trip.
- The main process remains the conflict resolver and durable/runtime authority.
- Historical or not-yet-hydrated conversations can still render metadata without eagerly mounting
  PTYs.
- `ConversationStore.status` remains as a compatibility field during the migration, but new UI
  code must use the shared selectors instead of reading it directly.
- Future provider-specific status sources can feed the same main reducer without adding another
  renderer state source.

## Validation

- Runtime preview and hydration-order regression tests cover the renderer runtime path.
- Task lifecycle event/rollback regression tests cover the independent persisted-status path.
- Existing renderer and full repository gates remain required before merge.
