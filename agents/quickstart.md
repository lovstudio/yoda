# Quickstart

## Toolchain

- Node: `24.14.0` from `.nvmrc`
- Package manager: `pnpm@10.28.2`
- Electron app root: this repo
- Landing page: `docs/` (docs content lives outside this repo — see `agents/workflows/docs-site.md`)

## Core Commands

```bash
pnpm run d
pnpm run dev
pnpm run dev:main
pnpm run dev:renderer
pnpm mobile
pnpm run build
pnpm run rebuild
pnpm run reset
```

## Validation Commands

```bash
pnpm run format
pnpm run lint
pnpm run typecheck
pnpm run test
```

## Docs Commands

```bash
pnpm run docs:build
```

## Important Notes

- The docs app and the Electron renderer both default to port `3000`.
- Mobile development uses `apps/mobile/` and the default-on desktop gateway. In development the gateway token defaults to `dev-mobile-token`, and desktop startup auto-starts local Expo Metro on `8081` when needed; override the token with `YODA_MOBILE_GATEWAY_TOKEN=<token> pnpm run dev`, or use `YODA_MOBILE_GATEWAY_DISABLED=1` to turn the gateway off. For iOS local testing, scan the desktop sidebar local Expo Go QR and use the desktop LAN URL plus `dev-mobile-token`. Use `YODA_MOBILE_METRO_DISABLED=1` to disable Metro auto-start, `YODA_MOBILE_EXPO_URL` if Metro uses another host or port, and `pnpm mobile:tunnel` when the phone cannot reach the desktop over LAN. Use `pnpm mobile:ios:device` for native scheme pairing tests. The same modal exposes install and connection QR codes; override the install target with `YODA_MOBILE_INSTALL_URL`.
- After native dependency changes (`sqlite3`, `node-pty`), run `pnpm run rebuild`.
- Husky and lint-staged run formatting and linting on staged files during commit.
