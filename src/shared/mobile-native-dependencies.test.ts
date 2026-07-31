import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('mobile native dependencies', () => {
  it('declares the Expo font module required by vector icons', () => {
    const mobilePackageUrl = new URL('../../apps/mobile/package.json', import.meta.url);
    const mobileRequire = createRequire(mobilePackageUrl);
    const mobilePackage = JSON.parse(readFileSync(mobilePackageUrl, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const expoNativeModules = JSON.parse(
      readFileSync(require.resolve('expo/bundledNativeModules.json'), 'utf8')
    ) as Record<string, string>;
    const installedExpoFont = JSON.parse(
      readFileSync(mobileRequire.resolve('expo-font/package.json'), 'utf8')
    ) as { version: string };

    expect(mobilePackage.dependencies?.['expo-font']).toBe(expoNativeModules['expo-font']);
    expect(mobilePackage.dependencies?.['expo-font']).toBe(`~${installedExpoFont.version}`);
  });
});
