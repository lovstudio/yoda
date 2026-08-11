# Browser Session Keeper

## Boundary

`apps/browser-session-keeper/` is a Manifest V3 Chrome companion for the real Chrome Profile used by browser automation. It is intentionally outside Yoda's Electron `<webview>` because Electron and Chrome own separate cookie jars.

The companion may:

- schedule background navigation to an explicitly configured read-only protected URL;
- classify the final URL as fresh, login-required, network-error, or unknown;
- retain one login handoff tab and notify the user;
- persist non-secret timing and status evidence.

It must not:

- read, export, log, or synchronize Cookie, Token, form values, or page content;
- click, scroll, submit forms, or replay state-changing actions;
- classify an unrecognized cross-origin redirect as authenticated;
- claim coverage of absolute timeouts, revoked credentials, device approval, or risk challenges.

## Implementation Ownership

- `policy.js` owns URL validation, classification, jitter, status evolution, and diagnostic redaction.
- `background.js` owns alarms, non-active probe tabs, transition notifications, and the single handoff tab.
- `options.js` and `options.html` own local configuration and diagnostics.
- Chrome `storage.local` stores configuration and sanitized status only. Query strings and fragments are stripped from diagnostics.

## Validation

Run:

```bash
pnpm --filter @yoda/browser-session-keeper check
pnpm --filter @yoda/browser-session-keeper test
```

For a real target, install the unpacked extension into the same Chrome Profile, log in manually once, run a single immediate probe, and verify both the fresh path and a genuine login redirect before enabling the schedule.
