import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const patch = readFileSync('native/macos/yoda-sparkle-updater/delta-only.patch', 'utf8');
const stableConfig = readFileSync('electron-builder.config.ts', 'utf8');
const canaryConfig = readFileSync('electron-builder.canary.config.ts', 'utf8');
const releaseBuild = readFileSync('scripts/release/build.ts', 'utf8');
const macVerification = readFileSync('scripts/release/verify-mac.ts', 'utf8');
const sparklePreparation = readFileSync('scripts/release/prepare-sparkle.ts', 'utf8');
const sparkleSigning = readFileSync('src/shared/sparkle-signing.ts', 'utf8');

describe('Yoda Sparkle helper patch', () => {
  it('blocks every non-delta request before download', () => {
    expect(patch).toContain('willDownloadUpdate:(SUAppcastItem *)item');
    expect(patch).toContain('if (!item.deltaUpdate)');
    expect(patch).toContain('127.0.0.1:9/yoda-full-update-disabled');
    expect(patch).toContain('full-update-blocked');
  });

  it('contains no full-download bypass', () => {
    expect(patch).not.toMatch(/allowFull|fallbackToFull|disableDeltaOnly/i);
  });

  it('emits structured progress events', () => {
    expect(patch).toContain('download-start');
    expect(patch).toContain('download-progress');
    expect(patch).toContain('ready-to-install');
    expect(patch).toContain('\\"type\\":\\"installing\\"');
  });

  it.each([
    ['stable', stableConfig],
    ['canary', canaryConfig],
  ])('embeds the helper and framework in %s macOS builds', (_channel, config) => {
    expect(config).toContain("to: 'Helpers/YodaSparkleUpdater'");
    expect(config).toContain("to: 'Frameworks/Sparkle.framework'");
    expect(config).toContain('SUPublicEDKey: SPARKLE_PUBLIC_ED_KEY');
    expect(config).toContain('NSAllowsLocalNetworking: true');
  });

  it('pins a non-empty Ed25519 public key without exposing a private key', () => {
    expect(sparkleSigning).toMatch(/SPARKLE_PUBLIC_ED_KEY = '[A-Za-z0-9+/]{43}='/);
    expect(sparkleSigning).not.toMatch(/PRIVATE|SECRET|SEED/);
  });

  it('prepares Sparkle before release packaging', () => {
    const prepare = releaseBuild.indexOf('scripts/release/prepare-sparkle.ts');
    const packageLoop = releaseBuild.indexOf('for (const arch of archs)');
    expect(prepare).toBeGreaterThan(-1);
    expect(prepare).toBeLessThan(packageLoop);
  });

  it('pins and verifies the official Sparkle release tools', () => {
    expect(sparklePreparation).toContain(
      "const SPARKLE_ARCHIVE_SHA256 = '1cb340cbbef04c6c0d162078610c25e2221031d794a3449d89f2f56f4df77c95'"
    );
    expect(sparklePreparation).toContain('archiveDigest !== SPARKLE_ARCHIVE_SHA256');
    expect(sparklePreparation).toContain("join(releaseToolsDir, 'bin')");
    expect(sparklePreparation).toContain("join(stageDir, 'bin', 'generate_appcast')");
  });

  it('preserves portable framework symbolic links', () => {
    expect(sparklePreparation).toContain('verbatimSymlinks: true');
    expect(macVerification).toContain("[join('Versions', 'Current'), 'B']");
    expect(macVerification).toContain("['Sparkle', 'Versions/Current/Sparkle']");
  });

  it('fails release verification without a signed guarded helper and framework', () => {
    expect(macVerification).toContain('Sparkle helper not found');
    expect(macVerification).toContain('Sparkle framework not found');
    expect(macVerification).toContain('yoda-full-update-disabled');
    expect(macVerification).toContain('codesign --verify --strict');
    expect(macVerification).toContain('0755 permissions for Sparkle delta eligibility');
  });
});
