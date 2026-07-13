# Mobile

## Structure

- `apps/mobile/`: Expo app for iOS, Android, and web preview.
- `src/main/core/mobile-gateway/`: desktop HTTP gateway for mobile clients.
- `src/shared/mobile-api.ts`: shared JSON API contract for the gateway and Expo app.
- `src/shared/mobile-session-events.ts`: shared SSE framing and session invalidation contract.

## Architecture Rules

- Keep mobile independent from Electron renderer code. Do not import MobX stores, renderer components, preload IPC, or `window.electronAPI` into `apps/mobile/`.
- Mobile talks to desktop through the gateway only.
- When Tailscale is active, connection info prefers its `100.64.0.0/10` address so a paired phone
  on the same tailnet can connect outside the physical LAN. LAN addresses remain fallbacks.
- The gateway starts by default and must require a token for non-health endpoints.
- Allow explicit disablement through `YODA_MOBILE_GATEWAY_DISABLED=1`, `YODA_MOBILE_GATEWAY_ENABLED=0`, or `YODA_MOBILE_GATEWAY=0`.
- The desktop sidebar mobile modal must support QR-based install and connection. `YODA_MOBILE_INSTALL_URL` can override the install QR target.
- Prefer polling snapshots for first-pass mobile workflows. Add server-sent events or WebSocket only when realtime behavior is required.
- Session detail realtime updates use authenticated server-sent events. The stream sends scoped
  invalidations only; clients refetch the existing detail endpoint, reconnect with backoff, and keep
  a low-frequency foreground reconciliation rather than polling every few seconds.
- Mobile Codex detail reads a bounded rollout tail; do not reintroduce full-file parsing for every
  live invalidation.
- Mobile request creation should use narrow desktop operations. Avoid exposing raw RPC or terminal controls over the gateway.

## Development

Start desktop. In development, the gateway token defaults to `dev-mobile-token` so Expo Go can
reconnect after desktop restarts:

```bash
pnpm run dev
```

Override it with `YODA_MOBILE_GATEWAY_TOKEN=<token>` when needed. Packaged/production builds
generate a random token unless the environment variable is set.

In development, desktop startup also auto-starts local Expo Metro on port `8081` when no Metro is
already running. Set `YODA_MOBILE_METRO_DISABLED=1` to turn off this auto-start, or set
`YODA_MOBILE_EXPO_URL` when Metro runs somewhere else.

Start Expo manually only when you want a separate terminal, tunnel mode, or custom flags:

```bash
pnpm mobile
```

For iOS local testing, use Expo Go first and enter the gateway URL/token manually in the app.
The desktop sidebar mobile modal shows a local Expo Go QR in development, inferred as
`exp://<gateway-host>:8081`. Because Expo Go can strip local QR query parameters, the app falls
back to `http://<gateway-host>:3879` plus `dev-mobile-token` in development. Use
`YODA_MOBILE_EXPO_URL` if Metro runs on another host or port.
Use `pnpm mobile:tunnel` when the phone cannot reach the desktop over LAN. Product-style pairing
through `yodamobile://connect` requires a native development build:

```bash
pnpm mobile:ios:device
```

For product-style pairing, open the desktop sidebar mobile modal, scan the install QR, then scan
the connection QR after installing the native app.
