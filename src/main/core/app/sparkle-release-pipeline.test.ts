import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const generator = readFileSync('scripts/release/generate-sparkle-appcast.ts', 'utf8');
const sparkleSmoke = readFileSync('scripts/release/smoke-sparkle-delta.ts', 'utf8');
const r2Uploader = readFileSync('scripts/release/upload-r2.ts', 'utf8');
const chinaUploader = readFileSync('scripts/release/upload-cn-mirror.ts', 'utf8');
const productionWorkflow = readFileSync('.github/workflows/release-prod.yml', 'utf8');
const canaryWorkflow = readFileSync('.github/workflows/release-canary.yml', 'utf8');

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

  it('refreshes stable manifests, appcasts, and overwritten latest binaries on Qiniu', () => {
    expect(chinaUploader).toContain('const latestAssetUrls = [...installers, ...blockmaps].map');
    expect(chinaUploader).toContain("joinUrl(publicBaseUrl, 'latest', basename(file))");
    expect(chinaUploader).toContain('...latestAssetUrls');
  });
});
