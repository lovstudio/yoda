# Risky Area: Updater And Packaging

## Main Files

- `src/main/core/updates/AutoUpdateService.ts`
- `src/main/core/updates/controller.ts`
- `build/`
- `package.json`
- `.github/workflows/release-prod.yml`
- `.github/workflows/release-canary.yml`
- `.github/workflows/windows-beta-build.yml`
- `.github/workflows/nix-build.yml`

## Rules

- avoid changing updater defaults casually
- treat signing, notarization, packaging targets, and native rebuild flow as release-critical
- keep build output directories and packaging config stable unless the task is explicitly about release behavior

## Current Notes

- macOS and Linux release jobs rebuild native modules for the target Electron version
- Windows beta builds intentionally use Node 20 in CI for native module stability
- changelog and auto-update behavior are separate but related surfaces in the app
- macOS uses the pinned `YodaSparkleUpdater` helper and architecture-specific Sparkle appcasts;
  the in-app path is delta-only and must never fall back to a complete ZIP
- update checks must have a hard deadline; proxy diagnostics must not block the request, and the
  macOS appcast fetch must receive the deadline's `AbortSignal` so a stalled check remains retryable
- the closed local Sparkle proxy URL must retain the `.delta` extension because Sparkle chooses
  `SUBinaryDeltaUnarchiver` from the downloaded URL path, not only from appcast metadata
- Sparkle release signing uses `src/shared/sparkle-signing.ts` for the public key and the
  `SPARKLE_ED_PRIVATE_KEY` Actions secret; rotate them only as one coordinated change
- run `pnpm run test:sparkle-delta` after changing the macOS helper, appcast generation, signing,
  staging, or install handoff
