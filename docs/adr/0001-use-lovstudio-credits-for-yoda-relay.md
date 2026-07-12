# ADR-0001: Use LovStudio credits for Yoda Relay access

## Status

Accepted

## Context

LovStudio already has Supabase Auth, an audited credit ledger, Creem checkout, and Alipay payment
webhooks. Building a second customer, invoice, or subscription ledger for Yoda would split identity
and make domestic payment support harder. Relay needs a simple paid entitlement that can be checked
quickly and revoked without coupling request forwarding to a payment provider.

## Decision

Use the LovStudio user ID as the Yoda account ID. Grant one seven-day trial, then sell a 30-day
Relay pass for 990 LovStudio credits. Activation is an atomic server-side Postgres operation that
spends credits and extends the current entitlement. Users buy credits through LovStudio's existing
payment page. Local Yoda and LAN mobile access remain free.

## Consequences

### Positive

- Creem and Alipay work without introducing new webhook paths.
- Payment provider details never enter the desktop application.
- The existing credit transaction ledger provides an audit trail and idempotency.

### Negative

- The first release is prepaid rather than automatically recurring.
- Users may need two steps when their credit balance is insufficient.

### Neutral

- Automatic renewal can be added later without changing Relay authorization.

## Alternatives considered

- A new Creem subscription product: rejected for the first release because it duplicates lifecycle
  handling and does not reuse the existing domestic payment path.
- A free public Relay: rejected because unbounded bandwidth creates abuse and operating-cost risk.
- Tailscale or another VPN: retained as an advanced direct-connect option, not the default product
  path, because China-region iOS distribution is unreliable.
