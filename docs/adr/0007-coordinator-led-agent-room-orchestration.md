# ADR 0007: Coordinator-led Agent Room orchestration

## Status

Accepted on 2026-08-08.

## Context

Agent Rooms exposed four choices as communication modes: process observation, room messages, a
shared file, and GitHub. That model mixed three independent concerns:

1. who decides what happens next;
2. how an assignment reliably reaches an Agent;
3. where Agents leave work for people and teammates to inspect.

The coupling produced a concrete false-success failure. A Planner called `team-at` with the natural
`@implementer` spelling. The router compared that value with the stored `implementer` handle,
matched no member, and returned HTTP 200. The Planner ended believing it had delegated while the
Implementer remained idle. Process observation also relied on ephemeral in-memory routing state,
so restart recovery and delivery acknowledgement were underspecified.

Adding a second intelligent daemon above every room would duplicate capabilities already present
in the lead Agent and would increase lifecycle, recovery, and token complexity.

## Decision

Every task still owns one Agent Room. A room has exactly one Agent member with the `leader` role;
that Agent is the **Coordinator**. Other members are **on-demand Workers**: Yoda creates or resumes a
Worker session only when it receives an assignment. Workers do not poll the room and do not need to
remain resident.

Yoda is a durable orchestration kernel, not another reasoning Agent:

- it canonicalizes identities and validates every target;
- it persists every assignment, including control-only assignments hidden from chat;
- it returns an acknowledgement only after the target session accepted the assignment;
- it observes terminal session state and sends a completion event back to the Coordinator;
- it restores pending assignments and routing budget after a main-process restart;
- it records delivery failure details instead of treating a no-op as success.

The Coordinator owns the intelligent loop: understand the current evidence, choose the next Worker,
write a concrete assignment, inspect the result, and either dispatch another step, ask the human, or
finish. Yoda owns only deterministic state transitions and session delivery.

```text
human requirement
       |
       v
Coordinator Agent <------ worker.completed + artifact reference
       |                                  ^
       | assign(worker, task)             |
       v                                  |
durable Room control record ---> on-demand Worker session
```

### Work records are adapters, not transports

The existing mode setting is retained for data compatibility but is presented as **Work record**:

- Agent sessions: the session and provider Transcript are the artifact;
- Room messages: conclusions are mirrored to the human timeline;
- Shared file: the worktree-relative file is the artifact;
- GitHub: Issues, pull requests, reviews, and checks are the artifact.

All four use the same durable assignment protocol. `syncToRoom` controls presentation only. A quiet
room therefore has the same scheduling semantics as a verbose room.

### Natural-language team blueprints

The next configuration surface should compile a user's short description into a typed blueprint,
not execute prose directly:

```ts
type TeamBlueprint = {
  coordinator: AgentSpec;
  workers: AgentSpec[];
  policy: {
    maxSteps: number | null;
    workRecord: 'session' | 'room' | 'shared-file' | 'github';
    syncToRoom: boolean;
  };
};
```

Exact model ids in the description are preserved. Relative terms such as “strong reasoning” and
“fast implementation” resolve through capability classes against the current MaaS/client model
catalog. The compiled blueprint is shown to the user and stored; runtime behavior never depends on
reinterpreting the original prose.

The Coordinator may create temporary Worker sessions from the compiled catalog when a role is first
needed. Stable roles can remain predeclared for predictable cost and permissions. Both forms share
the same room member and assignment protocol.

### GitHub workflow

Issue-to-PR-to-review is a Coordinator policy over the same event loop:

1. dispatch analysis with an Issue as the required artifact;
2. on completion, validate the Issue reference and dispatch implementation;
3. on PR creation or implementation completion, dispatch review;
4. on review completion, either return fixes to implementation or summarize completion to the human.

Desktop conditional polling remains reconciliation. A hosted GitHub App webhook may reduce latency,
but it emits the same durable room event and does not become a second orchestration engine.

## Delivery semantics and failure modes

- Delivery is at-least-once across a crash. Each assignment has a stable id included in the Worker
  prompt, allowing duplicate detection while recovery is reconciled.
- An unknown handle, inactive room, failed Feature gate, exhausted step budget, rejected session
  injection, or process-start error produces a negative acknowledgement with diagnostic text.
- A Worker completion always returns to the Coordinator unless that Worker already made an explicit,
  successfully acknowledged hand-off.
- A Coordinator ending without a hand-off means the workflow is complete and control returns to the
  human. There is no background Agent guessing another step.
- Human-directed messages remain visible even when room synchronization is off.

## Non-functional requirements

- **Reliability:** no successful acknowledgement without at least one accepted target; pending control
  records survive application restart.
- **Auditability:** target, assignment id, delivery status, error, Agent profile, and artifact location
  are inspectable without opening provider internals.
- **Bounded execution:** every cascade retains a configurable step limit; restart restores a bounded
  budget rather than silently setting it to zero.
- **Isolation:** one room's failure does not pause another room; GitHub polling remains single-flight
  per room.
- **Compatibility:** existing rooms and team templates migrate in place; their former communication
  value becomes the work-record adapter.
- **Performance:** Workers are started on demand; no per-room polling Agent or extra reasoning process
  is introduced.

## Alternatives considered

### Intelligent Yoda daemon per room

This centralizes decisions but duplicates the Coordinator, adds a paid reasoning loop, and creates a
second authority when its decision conflicts with the lead Agent. Rejected.

### Agents poll each other or shared artifacts

This keeps Yoda thin but wastes resources, has poor wake-up latency, and makes completion dependent on
every provider implementing a resident loop. Rejected.

### Fixed DAG only

A DAG is excellent for stable pipelines but handles review loops, human questions, and conditional
rework poorly. Typed blueprints may contain stages and gates, while the Coordinator retains the
decision loop. Rejected as the only execution model.

### Room messages as the transport

It is simple and useful for humans, but presentation preferences should not affect delivery. Room
messages remain one work-record adapter; durable control records carry assignments. Rejected as the
sole transport.

## Consequences

- The product model becomes simpler: one room, one Coordinator, on-demand Workers, one assignment
  protocol, and selectable work records.
- Planner-to-Implementer workflows no longer depend on visible chat messages or exact `@` spelling.
- Member model, reasoning length, and permission mode are captured when the room is created and passed
  into the real Agent session.
- The current UI can remain left chat plus right status/inspection while terminology shifts from
  “communication mode” to “work record.”
- Natural-language blueprint compilation becomes a configuration compiler over this stable runtime,
  rather than another orchestration mechanism.
