import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const generator = readFileSync('scripts/release/generate-sparkle-appcast.ts', 'utf8');
const sparkleSmoke = readFileSync('scripts/release/smoke-sparkle-delta.ts', 'utf8');
const r2Uploader = readFileSync('scripts/release/upload-r2.ts', 'utf8');
const chinaUploader = readFileSync('scripts/release/upload-cn-mirror.ts', 'utf8');
const chinaMirrorWorkflow = readFileSync('.github/workflows/release-cn-mirror.yml', 'utf8');
const productionWorkflow = readFileSync('.github/workflows/release-prod.yml', 'utf8');
const canaryWorkflow = readFileSync('.github/workflows/release-canary.yml', 'utf8');
const productionBuilderConfig = readFileSync('electron-builder.config.ts', 'utf8');
const canaryBuilderConfig = readFileSync('electron-builder.canary.config.ts', 'utf8');
const releaseBuild = readFileSync('scripts/release/build.ts', 'utf8');

describe('Sparkle release pipeline', () => {
  it('requires signing and retains enough history for skipped releases', () => {
    expect(generator).toContain("fail('SPARKLE_ED_PRIVATE_KEY is required");
    expect(generator).toContain("'--maximum-deltas'");
    expect(generator).toContain("'5'");
    expect(generator).toContain('validateGeneratedSparkleAppcast');
    expect(generator).toContain('qualifySparkleDeltaArtifacts');
    expect(generator).toContain('pinSparkleAssetUrls');
  });

  it('runs the native delta installation smoke through the packaged application proxy', () => {
    expect(sparkleSmoke).toContain('startSparkleFeedProxy');
    expect(sparkleSmoke).toContain('feedProxy.feedUrl');
  });

  it.each([
    ['production', productionWorkflow],
    ['canary', canaryWorkflow],
  ])('generates deltas before the macOS %s upload', (_name, workflow) => {
    const generateIndex = workflow.lastIndexOf('Generate signed Sparkle appcasts and deltas');
    const uploadIndex = workflow.lastIndexOf('Upload to R2');
    expect(generateIndex).toBeGreaterThan(-1);
    expect(uploadIndex).toBeGreaterThan(generateIndex);
    expect(workflow).toContain('pnpm run test:sparkle-delta');
  });

  it('publishes appcasts and deltas to every configured release store', () => {
    for (const uploader of [r2Uploader, chinaUploader]) {
      expect(uploader).toContain('findSparkleFeeds');
      expect(uploader).toContain('findSparkleDeltas');
    }
    expect(productionWorkflow).toContain('release/appcast-*.xml');
    expect(productionWorkflow).toContain('release/*.delta');
  });

  it('publishes DMGs as the only macOS full archive for stable and canary releases', () => {
    for (const workflow of [productionWorkflow, canaryWorkflow]) {
      expect(workflow).toContain('--targets dmg');
      expect(workflow).not.toContain('--targets dmg,zip');
    }
    for (const config of [productionBuilderConfig, canaryBuilderConfig]) {
      expect(config).toContain("target: 'dmg'");
      expect(config).not.toContain("target: 'zip'");
    }
    expect(releaseBuild).toContain("mac: 'dmg'");
    expect(generator).toContain('`${artifactPrefix}-${arch}.dmg`');
    expect(generator).not.toContain('`${artifactPrefix}-${arch}.zip`');
    expect(generator).toContain('compatibleDeltaHistory');
    expect(generator).toContain('cross-format ZIP-to-DMG');
    expect(generator).toContain('retainExistingSparkleHistoryItems');
    expect(productionWorkflow).not.toContain('release/*.zip');
    expect(chinaMirrorWorkflow).not.toContain("--pattern 'yoda-*.zip'");
  });

  it('refreshes stable manifests, appcasts, and overwritten latest binaries on Qiniu', () => {
    expect(chinaUploader).toContain('const latestAssetUrls = [...installers, ...blockmaps].map');
    expect(chinaUploader).toContain("joinUrl(publicBaseUrl, 'latest', basename(file))");
    expect(chinaUploader).toContain('...latestAssetUrls');
  });

  it('syncs the China mirror after the public release without blocking the primary DAG', () => {
    const publishIndex = productionWorkflow.indexOf('gh release edit "$RELEASE_TAG"');
    const dispatchIndex = productionWorkflow.indexOf('gh workflow run release-cn-mirror.yml');

    expect(productionWorkflow).not.toContain('uses: ./.github/actions/upload-cn-mirror');
    expect(publishIndex).toBeGreaterThan(-1);
    expect(dispatchIndex).toBeGreaterThan(publishIndex);
    expect(chinaMirrorWorkflow).toContain('gh release download "$RELEASE_TAG"');
    expect(chinaMirrorWorkflow).toContain('uses: ./.github/actions/upload-cn-mirror');
    expect(chinaMirrorWorkflow).toContain('platform: [linux, windows, macos]');
    expect(chinaMirrorWorkflow).toContain('fail-fast: false');
  });
});
