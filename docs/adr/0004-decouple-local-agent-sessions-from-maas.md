# ADR 0004: Decouple local Agent sessions from the active MaaS account

## Status

Accepted on 2026-07-27.

## Context

Yoda integrates several Agent runtimes and lets a user switch their current model provider or MaaS
binding. Codex and Claude persist their native sessions under account- or profile-specific state
roots. Treating the currently selected state root as the complete session inventory hides earlier
sessions after a provider switch, even though their transcripts remain on disk.

LovStudio is Yoda's product-level identity. Agent accounts are execution credentials and storage
provenance; they are not Yoda visibility boundaries.

## Decision

Yoda owns a stable conversation ID and stores provider-native resume coordinates separately:

- runtime and native session ID;
- absolute Agent state root;
- provider ID recorded when discovered, for display and diagnostics;
- an opaque catalog ID derived from runtime, state root, and native session ID.

The local session catalog reads all known state roots by default: the conventional Agent root, the
currently configured root, roots remembered from earlier runs, and immediately nested account or
profile roots. Project session views merge these native sessions with Yoda conversations and
deduplicate sessions already adopted by Yoda.

Opening an unadopted native session first shows its transcript. “Add to Yoda and continue” creates a
normal Yoda task and conversation without copying or rewriting the transcript. Subsequent history,
status, archive, title, summary, fork, and resume operations use the stored native ID and state root.

For Codex MaaS, Yoda lazily reconciles the active Yoda MaaS binding into the source state root before
resume. Agent-native account files remain isolated per root while session discovery remains global.

## Consequences

- Switching MaaS or Agent accounts no longer hides local history.
- Yoda's LovStudio identity remains independent of Agent account partitions.
- Imported sessions keep stable provenance while behaving like normal Yoda conversations.
- No database migration is needed because source metadata lives in the existing conversation config
  JSON and known roots use the existing application settings table.
- Profile discovery is intentionally shallow and local. A future privacy control may disable
  cross-profile scanning without changing the stored conversation model.
