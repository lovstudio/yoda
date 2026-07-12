# ADR-0002: Bridge the mobile HTTP API over an outbound WebSocket

## Status

Accepted

## Context

Yoda Mobile already uses a narrow token-protected REST and SSE API served by the desktop. Rewriting
the mobile feature surface around a new RPC protocol would duplicate authorization and behavior.
Most desktop users cannot accept inbound connections because of NAT, firewalls, or carrier-grade
networking.

## Decision

Run a stateless Relay that exposes the same HTTP paths and bridges each request over a desktop-owned
outbound WebSocket. Response start, body chunks, and completion are framed so ordinary JSON and SSE
share one transport. Relay accepts only the existing `/v1/*` mobile namespace and never exposes raw
Electron RPC or terminal primitives.

## Consequences

### Positive

- Existing mobile endpoints and polling/SSE behavior are reused.
- No inbound desktop port, VPN, or public IP is required.
- Relay can scale horizontally later with device-to-instance routing.

### Negative

- The MVP requires sticky device routing or a single Relay instance.
- Relay availability becomes part of the remote-control path.

### Neutral

- Task data passes through Relay memory but is not persisted there.

## Alternatives considered

- Cloudflare Tunnel per user: rejected as the default because onboarding and mainland reliability
  are outside Yoda's control.
- Peer-to-peer WebRTC only: rejected because symmetric NAT still requires TURN and complicates SSE.
- Reimplement the mobile API as cloud RPC: rejected because it would make LovStudio the execution
  authority instead of the user's desktop.
