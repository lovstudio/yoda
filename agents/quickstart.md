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
- Development builds do not claim the `yoda://` deep-link protocol by default, so they do not steal links from the installed app. Use `YODA_REGISTER_DEEP_LINKS=1 pnpm run dev` only when explicitly testing OS-level deep links against the dev app.
- The mobile client is a separate repository (`lovstudio/yoda-mobile`); this repo only runs the default-on desktop gateway. In development the gateway token defaults to `dev-mobile-token`; override it with `YODA_MOBILE_GATEWAY_TOKEN=<token> pnpm run dev`, or use `YODA_MOBILE_GATEWAY_DISABLED=1` to turn the gateway off. Opening the mobile view auto-starts Expo Metro on `8081` only when `YODA_MOBILE_REPO_PATH` points at that checkout; otherwise it logs a hint and skips (use `YODA_MOBILE_METRO_DISABLED=1` to never auto-start, or `YODA_MOBILE_EXPO_URL` when Metro already runs elsewhere). For iOS local testing, scan the desktop sidebar local Expo Go QR and use the desktop LAN URL plus `dev-mobile-token`; tunnel mode and native device builds are commands in the client repo. The same modal exposes install and connection QR codes; override the install target with `YODA_MOBILE_INSTALL_URL`.
- After native dependency changes (`sqlite3`, `node-pty`), run `pnpm run rebuild`.
- Husky and lint-staged run formatting and linting on staged files during commit.
