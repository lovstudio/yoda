# ego-browser Session Health

## Architecture

Browser-session health runs inside Yoda; there is no Chrome extension or
independent background companion. Yoda owns the lightweight schedule and uses
ego-browser only as the browser control surface. The scheduler starts and stops
the health service with the rest of Yoda's automation lifecycle.

Every probe reuses the named ego task space `Yoda 会话保活`. Do not create an
anonymous task space for each run. Target identity, the last sanitized outcome,
the next probe time, and ownership state belong to Yoda; the live page and task
space ownership belong to ego-browser.

## Ownership and Handoff

- A background probe proceeds only while Yoda already owns the named task
  space. It must not compete with the user or another agent for control.
- When a target needs login, Yoda records `auth_required`, notifies the user,
  and hands the task space to the user.
- Yoda never calls `takeOverTaskSpace` from a timer, retry, startup path, or
  ownership transition. It resumes only after an explicit user action confirms
  that login is complete and control is being returned.
- A missed handoff or unavailable task space is a deferred probe, not evidence
  that the session is healthy or expired.

## Data and Interaction Boundary

The health check navigates the same real tab to an explicitly configured,
read-only URL on every probe so a reused tab still produces a fresh GET. It then
classifies sanitized navigation evidence. Persist only target identity,
origin/path without query or fragment, timestamps, ownership state, and the
high-level health result.

The service must never read, export, log, synchronize, or persist cookies,
tokens, authorization headers, form values, response bodies, or page bodies.
It must not click, scroll, type, submit, replay state-changing actions, or
attempt to clear a challenge. Unknown redirects remain `unknown`; they are not
proof of a healthy login.

## Expiration Boundary

Periodic activity can observe or postpone an idle timeout only when the target
itself permits that behavior. It does not extend a server-enforced absolute
expiration, revive revoked credentials, satisfy device approval, or bypass a
risk challenge. Once the absolute boundary is reached, the correct result is
`auth_required` and the only continuation is the explicit user handoff flow.
Never report a session as permanently kept alive.

## Validation

Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, and the
browser-session-health service tests. For a real target, verify the healthy,
login-required, unknown-redirect, deferred-ownership, explicit-resume, and
absolute-expiration paths in the same named ego task space.
