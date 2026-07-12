# ADR 0003: Use LovStudio as Yoda's account control plane

## Status

Accepted on 2026-07-12.

## Context

Yoda needs one durable identity for paid and cloud-backed product capabilities. Creating a second
Yoda-only account, wallet, or entitlement system would split user identity and duplicate payment,
device, fraud, and support workflows already owned by LovStudio.

Yoda must also remain useful when LovStudio or the network is unavailable. Local projects, agents,
terminals, and LAN mobile access do not need a cloud identity.

## Decision

LovStudio is the global account and commercial control plane for Yoda:

- Supabase Auth issues the LovStudio session used by Yoda desktop.
- LovStudio owns the user profile, credit wallet, payment orders, entitlements, and device registry.
- Account-backed integrations such as GitHub OAuth use the same identity.
- Yoda Relay is the first paid cloud capability and uses LovStudio credits and entitlements.
- Future cloud sync, team, marketplace, and managed compute features must use the same account API
  and server-authoritative entitlement checks instead of introducing local license flags.

The desktop stores access and refresh credentials in encrypted application secrets. Account-scoped
caches and Relay credentials are keyed by LovStudio user ID and cleared when the identity changes.
The sidebar and settings expose the same global account state.

Yoda supports an explicit local-only mode. Authentication is recommended during onboarding but is
required only when a user invokes an account-backed capability. Signing out revokes the server
session and Relay device while preserving local projects.

## Consequences

- A user has one identity and one wallet across LovStudio and Yoda.
- Payment callbacks never grant value from provider-supplied metadata; they complete a previously
  persisted LovStudio payment order.
- New cloud features need an authenticated LovStudio API and a server-side entitlement, even if a
  local UI flag also exists.
- Local Yoda workflows degrade gracefully during a LovStudio outage, while cloud features fail
  closed.
- Production rollout order is database migrations, LovStudio APIs and payment functions, Relay,
  then Yoda clients.
