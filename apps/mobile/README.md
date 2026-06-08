# Yoda Mobile

Yoda Mobile is an Expo app for checking desktop project status and starting new requests from a phone. It talks to the desktop app through the desktop mobile gateway in `src/main/core/mobile-gateway/`.

## Why Expo

Expo is the right first architecture for this product:

- it gives Yoda a real native mobile app without coupling mobile screens to Electron renderer code;
- it keeps the shared contract small: JSON API types in `src/shared/mobile-api.ts`;
- it supports iOS, Android, and web previews from one React Native codebase;
- it is enough for the first mobile scope: project/task snapshots, lightweight polling, and request submission.

Do not import Electron renderer stores, MobX project stores, or preload IPC into this app.

## Desktop Gateway

The gateway starts by default with the desktop app, listens on port `3879`, and requires a token for every non-health request. In development, the default token is `dev-mobile-token` so Expo Go can reconnect after desktop restarts. In production, desktop generates a random token unless `YODA_MOBILE_GATEWAY_TOKEN` is set.

Override the development token when needed:

```bash
YODA_MOBILE_GATEWAY_TOKEN=custom-mobile-token pnpm run dev
```

Optional overrides:

```bash
YODA_MOBILE_GATEWAY_HOST=0.0.0.0
YODA_MOBILE_GATEWAY_PORT=3879
YODA_MOBILE_INSTALL_URL=https://example.com/yoda-mobile
YODA_MOBILE_EXPO_URL=exp://192.168.1.10:8081
YODA_MOBILE_METRO_DISABLED=1
```

Disable the gateway:

```bash
YODA_MOBILE_GATEWAY_DISABLED=1 pnpm run dev
# or
YODA_MOBILE_GATEWAY_ENABLED=0 pnpm run dev
```

Use a LAN address from the desktop log, for example `http://192.168.1.10:3879`. The phone and desktop must be on the same network.

## Local iOS Test First

The fastest path is Expo Go on a physical iPhone. This does not install a Yoda-branded
native app yet; it runs the current mobile code from the local Expo development server.

1. Install Expo Go from the iOS App Store.
2. Start the desktop app. The development gateway token defaults to `dev-mobile-token`:

```bash
pnpm run dev
```

3. Desktop startup auto-starts the local Expo development server on port `8081` when needed. Start
   it manually only when you want a separate terminal, tunnel mode, or custom flags:

```bash
pnpm mobile
```

Use `pnpm mobile:tunnel` if the phone cannot reach the desktop over LAN.
If Expo prints a proxy or virtual-network address such as `198.18.0.1`, restart it with the
real Mac LAN address:

```bash
REACT_NATIVE_PACKAGER_HOSTNAME=$(ipconfig getifaddr en0) pnpm mobile
```

4. Scan the Expo QR code with the iPhone Camera app. Expo Go on iOS does not expose a
   separate in-app scanner.
5. In Yoda Mobile, enter:

- Gateway URL: the desktop LAN URL, for example `http://192.168.1.10:3879`
- Token: `dev-mobile-token`, or the token shown in the desktop sidebar if overridden

The desktop sidebar mobile modal also shows a local Expo Go QR when the desktop app runs in
development. Scan it with the iPhone Camera app. It is inferred from the gateway LAN address as
`exp://<gateway-host>:8081/--/connect?...`. Expo Go can drop the query parameters from local
launch URLs, so the mobile app also infers `http://<gateway-host>:3879` with `dev-mobile-token`
in development. Override the Expo host with `YODA_MOBILE_EXPO_URL` if Metro uses a different host
or port.

In Expo Go, the desktop connection QR that opens `yodamobile://connect` is not expected to
auto-pair because custom app schemes require a native development build.

## Native iOS Development Build

Use this when you need to test the branded app shell, custom scheme pairing, or native
configuration on an iPhone:

```bash
pnpm mobile:ios:device
```

This requires Xcode, iOS signing access, and a connected iPhone. For simulator testing:

```bash
pnpm mobile:ios:simulator
```

## Start The Mobile App

```bash
pnpm install
pnpm mobile
```

Open with Expo Go or a simulator, then enter:

- Gateway URL: the desktop LAN URL
- Token: `dev-mobile-token` in development, or `YODA_MOBILE_GATEWAY_TOKEN` if overridden

The desktop sidebar also exposes a mobile connection modal. Scan the install QR to open the
configured mobile download page, then scan the connection QR to open `yodamobile://connect` and
pair the app with the current desktop gateway automatically.

## Current Scope

- `GET /v1/snapshot` shows projects, open/idle state, active tasks, lifecycle status, and bootstrap status.
- `POST /v1/demands` creates a no-worktree task with an initial conversation. If no project is selected, it targets the internal Drafts project.
- The mobile UI polls every 8 seconds and supports pull-to-refresh.

Future work should add device-level sessions, push notifications, and a realtime event stream before exposing terminal or diff controls.
