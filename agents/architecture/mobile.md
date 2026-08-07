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
- Pairing is an onboarding action, not a launch action. After the first successful exchange, native
  clients must restore the saved SecureStore credential before considering inferred Expo/development
  connections. Only an explicit new pairing deep link may replace the saved connection.
- Allow explicit disablement through `YODA_MOBILE_GATEWAY_DISABLED=1`, `YODA_MOBILE_GATEWAY_ENABLED=0`, or `YODA_MOBILE_GATEWAY=0`.
- The desktop sidebar mobile modal must support QR-based install and connection. `YODA_MOBILE_INSTALL_URL` can override the install QR target.
- Prefer polling snapshots for first-pass mobile workflows. Add server-sent events or WebSocket only when realtime behavior is required.
- Session detail realtime updates use authenticated server-sent events. The stream sends scoped
  invalidations only; clients refetch the existing detail endpoint, reconnect with backoff, and keep
  a low-frequency foreground reconciliation rather than polling every few seconds.
- Mobile Codex detail reads a bounded rollout tail; do not reintroduce full-file parsing for every
  live invalidation.
- Mobile request creation should use narrow desktop operations. Avoid exposing raw RPC or terminal controls over the gateway.
- Session continuation distinguishes a currently `running`/`acceptsInput` process from a persisted
  `resumable` conversation. A cold resumable session stays actionable in the composer; the input
  route opens the project, provisions the task, and resumes the original conversation before text,
  image, or voice-transcribed input is injected.
- Mobile image input uploads through `/v1/attachments` in bounded base64 chunks, then passes opaque attachment ids to demand/session input routes. The desktop stores generated filenames under app data and reuses `injectConversationPrompt`; never send phone filenames as trusted desktop paths. Images are local-project-only until the gateway has an explicit SSH transfer path.
- Voice input is speech-to-editable-text on the phone, not an audio file disguised as an Agent attachment. It uses `expo-localization` preferences negotiated against `expo-speech-recognition.getSupportedLocales()`; never pass an app-region hybrid such as `en-CN` directly to the recognizer. Pass bounded, deduplicated `contextualStrings` containing current project/task/session names plus Yoda's stable product and development vocabulary so native recognition can bias toward domain hot words. Both modules require a native development/production build; Expo Go keeps system-keyboard dictation as its fallback.
- The new-request attribution selector is a compact input-toolbar badge. Its bounded, scrollable modal sheet first selects a project, then either creates an independent project task or selects an existing task as the parent. Keep long-term tasks easy to identify and near the top; never let a long project/task list push the primary submit action down the page.
- Project and task picker sheets must keep their search field visible above the scrollable results. Project search covers both display and source names; parent-task search preserves the established long-term, pinned, and recent ordering.
- The shared mobile input toolbar exposes installed Skills through its expandable tools tray. Skill search is served by the authenticated gateway for the current project or conversation; selecting one inserts the runtime-native explicit command into the visible input so new tasks and follow-up turns use the same editable send path.

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
the connection QR after installing the native app. The connection QR is needed once per device;
later launches restore the saved credential automatically unless the user explicitly disconnects or
the desktop device is revoked.

## Installed App Delivery

- A user-requested mobile feature or fix is complete only after the latest `main` code is installed
  into the branded `Yoda Mobile` app (`ai.lovstudio.yoda.mobile`) on the user's connected iPhone.
  A source commit, passing tests, an Expo bundle, or a successful native build alone is not the
  user-visible completion condition.
- Merge the change to `main` first, then build a signed Release app from that exact mainline commit,
  overwrite-install it on the connected device, launch it, and verify the requested behavior there.
  Overwrite the existing bundle instead of uninstalling it so SecureStore pairing data is retained.
- Confirm the Release `main.jsbundle` contains a marker from the changed mobile code and use
  `xcrun devicectl device info apps` plus `xcrun devicectl device process launch` to verify the
  installed bundle and launch. If Expo reports `Build Succeeded` but stalls while connecting to a
  newer iOS device, install the generated `.app` directly with
  `xcrun devicectl device install app`.
- Treat Expo, Metro, Xcode, and `devicectl` as implementation details. Report completion in terms of
  what the installed `Yoda Mobile` app on the phone can now do.
