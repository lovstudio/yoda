# macOS Delta-Only Updates Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Yoda's macOS Squirrel update path with a Sparkle-based updater that can only transfer signed delta packages and can never fall back to a full application download.

**Architecture:** Keep the existing `UpdateService` as the renderer-facing state machine and introduce platform backends. The macOS backend invokes a pinned out-of-process Sparkle helper that reports progress on stderr and rejects every non-delta `SUAppcastItem` before its request starts. Release scripts build/embed the helper and framework, generate architecture-specific signed appcasts and deltas, and fail closed when the delta matrix is incomplete.

**Tech Stack:** TypeScript, Electron 42, electron-builder, Objective-C, Sparkle 2.9.2, Vitest, GitHub Actions.

---

### Task 1: Document and test the delta-only feed contract

**Files:**
- Create: `scripts/release/lib/sparkle-appcast.ts`
- Create: `src/main/core/updates/sparkle-appcast.test.ts`

1. Write failing tests for architecture-specific feed selection, matching `sparkle:deltaFrom`, rejection of appcasts without a current-version delta, and rejection of top-level full URLs in the in-app feed contract.
2. Run `pnpm exec vitest run src/main/core/updates/sparkle-appcast.test.ts --project node` and confirm failure.
3. Implement the smallest typed parser/validator needed by both release checks and the runtime backend.
4. Rerun the focused test and confirm it passes.

### Task 2: Build a pinned delta-only Sparkle helper

**Files:**
- Create: `native/macos/yoda-sparkle-updater/delta-only.patch`
- Create: `scripts/release/prepare-sparkle.ts`
- Create: `src/main/core/app/sparkle-helper-build.test.ts`
- Modify: `scripts/release/tsconfig.json`

1. Test the patch contract: the helper must inspect `isDeltaUpdate`, replace any regular-update request with a blocked local URL, emit `YODA_FULL_UPDATE_BLOCKED`, and never contain a configurable bypass.
2. Pin Sparkle source tag and commit plus archive checksum in the preparation script.
3. Download/cache the source, verify identity, apply the patch, build universal arm64/x64 Release artifacts, and stage `Sparkle.framework` plus `YodaSparkleUpdater` under `build/sparkle/`.
4. Verify executable architectures, framework linkage, and the delta-only marker.

### Task 3: Embed and verify Sparkle in packaged macOS bundles

**Files:**
- Modify: `electron-builder.config.ts`
- Modify: `electron-builder.canary.config.ts`
- Modify: `scripts/release/build.ts`
- Modify: `scripts/release/verify-mac.ts`

1. Run Sparkle preparation before macOS packaging only.
2. Copy `Sparkle.framework` to `Contents/Frameworks` and the helper to `Contents/Helpers`.
3. Add `SUPublicEDKey` and architecture feed metadata to the app Info.plist.
4. Extend verification to require valid signatures for the framework/helper and reject a bundle without the delta-only marker.

### Task 4: Add the macOS Sparkle backend

**Files:**
- Create: `src/main/core/updates/update-backend.ts`
- Create: `src/main/core/updates/sparkle-update-backend.ts`
- Create: `src/main/core/updates/sparkle-update-backend.test.ts`
- Modify: `src/main/core/updates/update-service.ts`
- Modify: `src/main/index.ts`

1. Define a backend interface matching check, download, install, dispose, progress, and error events.
2. Test helper argument escaping, arm64/x64 feed selection, progress parsing, `YODA_FULL_UPDATE_BLOCKED` mapping, and the absence of any full-download retry.
3. Select Sparkle only for packaged macOS; retain electron-updater elsewhere.
4. On install, finish Yoda teardown before allowing Sparkle to atomically replace and relaunch the App Bundle.

### Task 5: Generate and validate release deltas

**Files:**
- Create: `scripts/release/generate-sparkle-appcast.ts`
- Create: `src/main/core/app/sparkle-release.test.ts`
- Modify: `.github/workflows/release-prod.yml`
- Modify: `scripts/release/upload-r2.ts`
- Modify: `scripts/release/upload-cn-mirror.ts`

1. Download the configured number of prior Sparkle-compatible ZIPs per architecture.
2. Run Sparkle `generate_appcast` with the production EdDSA key and current release URL prefix.
3. Keep architecture feeds separate and upload all generated `.delta` files.
4. Fail release when the newest item lacks a delta from any advertised supported source version, any delta is unsigned, or a feed exposes a full archive URL to the in-app client.
5. Upload appcasts last so clients never observe a partial release.

### Task 6: Provision signing material and verify end to end

**Files:**
- Modify: `.github/workflows/release-prod.yml`
- Modify: `agents/risky-areas/updater.md`

1. Generate one Sparkle Ed25519 key pair, commit only the public key, and store the private key as the repository's protected `SPARKLE_EDDSA_PRIVATE_KEY` secret without printing it.
2. Build two signed local fixture bundles and generate a real delta.
3. Confirm the helper downloads only the `.delta`, applies it, verifies the resulting code signature, relaunches the new version, and emits no request for ZIP/DMG.
4. Corrupt the old fixture and confirm the update fails with `DELTA_REQUIRED` without requesting the full artifact.
5. Run `pnpm run format`, `pnpm run lint`, `pnpm run typecheck`, and `pnpm run test`.
