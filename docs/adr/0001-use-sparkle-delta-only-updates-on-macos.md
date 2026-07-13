# ADR-0001: Use Sparkle Delta-Only Updates on macOS

## Status

Accepted

## Context

Yoda currently uses `electron-updater`, which delegates installation to Squirrel.Mac and performs blockmap downloads against a cached previous `update.zip`. A DMG installation does not populate that cache, so its first update downloads the complete application archive. Product requirements prohibit full application downloads from the in-app updater under every condition, including missing deltas and failed delta application.

The first release containing the new updater establishes the compatibility boundary. Older installations are not migrated automatically.

## Decision

Use Sparkle 2.9.2 for macOS application updates while keeping electron-builder, DMG distribution, Apple signing, notarization, and the existing Windows/Linux update implementations.

A pinned, Yoda-specific build of the official out-of-process `sparkle-cli` will be embedded in `Yoda.app` together with `Sparkle.framework`. The helper will enforce a delta-only invariant in `SPUUpdaterDelegate.updater(_:willDownloadUpdate:with:)`: any item for which `isDeltaUpdate` is false is rejected before network transfer. Missing, incompatible, or invalid deltas therefore surface an update error and never trigger Sparkle's regular full-update fallback.

The macOS release job will retain prior Sparkle-compatible ZIP archives, generate signed deltas and architecture-specific appcasts, verify that every supported source version has a delta, and upload only the appcast and delta artifacts to the in-app update feed. Complete DMG/ZIP assets remain available for manual installation but are not reachable through the in-app update protocol.

## Consequences

### Positive

- DMG installations can update directly from the installed App Bundle without a cached release ZIP.
- Full application downloads are mechanically blocked in the client.
- Sparkle supplies atomic replacement, code-signature validation, EdDSA verification, and relaunch handling.
- Existing packaging, signing, notarization, mirrors, and non-macOS update paths remain intact.

### Negative

- The release pipeline must retain prior compatible archives and generate a delta for each supported source version and architecture.
- A missing or failed delta blocks the update instead of recovering with a full download.
- Sparkle security upgrades require rebuilding and revalidating the pinned helper.
- Existing pre-Sparkle installations are outside the automatic migration boundary.

### Neutral

- Full DMG and ZIP assets continue to exist for website/manual installation.
- macOS and Windows/Linux use different updater backends behind the same Yoda update state model.

## Alternatives Considered

**Keep Squirrel.Mac blockmaps**

Rejected because first update after DMG installation has no cached `update.zip` baseline.

**Recreate the old release ZIP locally**

Rejected because byte identity depends on archive order, timestamps, permissions, extended attributes, and compression details. This is not a reliable production invariant.

**Replace all packaging with Conveyor**

Rejected because it changes the cross-platform packaging and release system when only the macOS updater needs replacement.

**Use unmodified Sparkle fallback behavior**

Rejected because upstream Sparkle downloads the regular archive when a delta is unavailable or cannot be applied, violating the explicit product requirement.

## References

- https://www.electronjs.org/docs/latest/api/auto-updater/
- https://sparkle-project.org/documentation/delta-updates/
- https://sparkle-project.org/documentation/sparkle-cli/
- https://sparkle-project.org/documentation/api-reference/Protocols/SPUUpdaterDelegate.html
