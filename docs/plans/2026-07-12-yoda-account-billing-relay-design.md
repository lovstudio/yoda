# Yoda account, billing, and Relay

This implementation is the first delivery of the product-wide LovStudio account control plane
defined in [ADR 0003](../adr/0003-lovstudio-as-yoda-account-control-plane.md). Relay is one
account-backed capability, not a separate identity silo. The same session, wallet, payment-order
ledger, entitlement rules, cache isolation, and device revocation model are the required foundation
for future Yoda cloud services.

## Requirements

Yoda uses the existing LovStudio identity instead of creating another account system. A signed-in
user can see their LovStudio credit balance, start a seven-day Relay trial once, buy credits through
the existing LovStudio checkout, and spend 990 credits to activate a 30-day Relay pass. Local mobile
connections remain free. Relay lets the mobile app reach the desktop without a VPN: the desktop
makes an outbound WebSocket connection and the phone uses ordinary HTTPS/SSE.

The first release targets a single relay region, 99.9% availability, a 30-second request timeout,
128 KiB request bodies, and bounded per-device concurrency. Payment and entitlement state is
strongly consistent in Postgres. Relay transport is ephemeral: it stores no task content and returns
503 when the desktop is offline. All public traffic uses TLS. Pairing codes are one-time and expire
after ten minutes; long-lived host and mobile tokens are separate, revoked with their desktop
device, and stored only as
SHA-256 hashes by LovStudio.

## Architecture

```text
LovStudio Web / Supabase
  Auth + credits + Yoda Relay pass + device credential hashes
        ^ account JWT                    ^ internal service secret
        |                                |
Yoda Desktop -- outbound WSS --> Yoda Relay <-- HTTPS/SSE -- Yoda Mobile
     |                                      |
     +-- 127.0.0.1 mobile gateway <---------+ request/response bridge
```

The desktop exchanges its existing LovStudio access token for a registered Relay device and a host
credential. The QR contains only a short-lived pairing code. Mobile exchanges that code for a
device credential and stores it in the platform secure store. Relay authenticates credentials with
LovStudio, forwards only `/v1/*` mobile gateway operations, strips caller authorization, and lets
the desktop inject its private local gateway token. JSON responses and SSE chunks use the same
framed protocol, so existing mobile API contracts remain unchanged.

## Failure handling

- LovStudio unavailable: existing local connection keeps working; no new pairing or renewal.
- Relay unavailable: connector retries with capped exponential backoff; UI reports disconnected.
- Desktop offline: Relay returns 503 without queueing commands.
- Duplicate payment/activation: Postgres row locking and idempotent transaction references prevent
  double spending.
- Leaked phone token: revoke the device from Yoda; host and phone credentials are separate.
- Expired pass: Relay authorization denies new sessions; local LAN access remains available.

## Delivery boundary

This repository contains the desktop connector, mobile pairing exchange, secure credential storage,
shared protocol, and a deployable Relay service. The LovStudio Web repository contains migrations
and authenticated account/device APIs. Production deployment still requires a Relay hostname and a
shared service secret in both deployments.
