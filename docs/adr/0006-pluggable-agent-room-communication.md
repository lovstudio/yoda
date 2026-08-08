# ADR 0006: Pluggable Agent Room communication

## Status

Accepted on 2026-08-08.

## Context

Agent Rooms originally used one communication mechanism for both orchestration and presentation:
every Agent had to call `team-at`, which persisted a specially addressed room message and then
continued the target Agent's session. This made the group chat the transport, coordination record,
and human activity feed at the same time.

That coupling is restrictive. Some teams should be observable from their processes and provider
transcripts, some need a shared planning artifact, and some use GitHub Issues and pull requests as
the durable record. Users should also be able to keep the room quiet without losing visibility into
an Agent's current state or output.

GitHub webhooks provide timely event delivery, but a desktop application does not have a stable
public callback address. A local-only implementation therefore needs polling, while a hosted Relay
can receive signed webhook deliveries and forward normalized signals to connected Yoda clients.

## Decision

Every Agent Team and instantiated Team Room owns a normalized `TeamCommunicationConfig` with one of
four modes:

- `process`: Yoda observes the Agent session, process state, hooks, and provider transcript. Ending a
  turn is sufficient to return control to the leader.
- `message-hub`: Agents explicitly hand off through the room hub. This preserves the original
  behavior and is the migration default.
- `shared-file`: Agents keep substantive hand-off state in one worktree-relative file. Room signals
  carry only routing intent and a reference to that file.
- `github`: an Issue and/or pull request is the durable coordination record. Yoda watches configured
  resources and wakes the room leader when their `updated_at` value changes.

All modes share a small control plane that can continue a target Agent session. A control signal may
be persisted as a room message or remain ephemeral. `syncToRoom` controls that presentation choice;
it does not disable routing, process observation, or artifact access.

```text
Agent turn / external event
           |
           v
   normalized control signal ---------> Room conductor ---------> target session
           |
           +-- syncToRoom=true -------> group-chat timeline
           |
           +-- syncToRoom=false ------> no timeline row

Durable work body: session transcript | room message | shared file | GitHub Issue/PR
```

Clicking an Agent remains the universal inspection path. The detail surface reads a main-process
observation snapshot and shows runtime state, PID when available, the real Claude Transcript or
Codex rollout path, the shared artifact path, and configured GitHub work-item links. The renderer
does not derive provider paths or resolve filesystem paths itself.

### GitHub monitoring

The first implementation is a local authenticated monitor:

- it runs only for active rooms in `github` mode;
- repository configuration accepts `owner/repo` or inherits the project's primary remote;
- it polls configured Issue and pull request resources every 60 seconds;
- it sends `If-None-Match` using the last ETag and treats `304 Not Modified` as an unchanged result;
- only a changed resource timestamp emits a control signal;
- failures are isolated per room, retried on the next interval, and exposed with copyable debug
  details in the Agent inspection surface.

A hosted real-time extension should use a GitHub App or repository webhook received by Yoda Relay:

1. validate the delivery signature and deduplicate by delivery id;
2. normalize subscribed Issue, pull request, review, and comment events;
3. route by account, repository, and configured room work item;
4. forward the normalized event over the existing outbound Relay connection;
5. keep conditional desktop polling as reconnect reconciliation and fallback.

GitHub Actions are useful for repository-side automation, but are not the primary watcher: they
couple orchestration to workflow files, run only after matching repository events, and still need a
delivery path back to the user's room.

## Non-functional requirements

- Existing rooms keep `message-hub` with room synchronization enabled after migration.
- Shared-file paths are normalized and resolved inside the task worktree.
- Room UI remains responsive; GitHub network work runs in the main process and is single-flight per
  room.
- Monitoring survives renderer reloads and is reconciled from active rooms on application startup.
- A room configuration update starts or stops its watcher without restarting Yoda.
- Monitoring timers are disposed during application shutdown.
- Agent status and artifacts remain inspectable when room synchronization is disabled.

## Consequences

- The left group chat and right Agent status layout stay stable while teams can choose where their
  work record lives.
- Explicit Agent messages are no longer required for process-observed completion, shared-file
  hand-offs, or GitHub-triggered continuation.
- The room conductor remains the session-delivery engine, but the room message table is no longer
  its only input.
- Local GitHub changes may take up to one polling interval to appear. Real-time delivery requires the
  Relay webhook extension described above.
- Transcript visibility follows provider and workspace capabilities; SSH sessions may expose status
  without a local transcript path.
