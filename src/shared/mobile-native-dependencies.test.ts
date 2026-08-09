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

  it('declares and configures image, locale, and speech input native modules', () => {
    const mobilePackage = JSON.parse(
      readFileSync(new URL('../../apps/mobile/package.json', import.meta.url), 'utf8')
    ) as { dependencies?: Record<string, string> };
    const mobileConfig = JSON.parse(
      readFileSync(new URL('../../apps/mobile/app.json', import.meta.url), 'utf8')
    ) as { expo?: { plugins?: unknown[] } };
    const plugins = JSON.stringify(mobileConfig.expo?.plugins ?? []);
    const voiceInputSource = readFileSync(
      new URL('../../apps/mobile/src/voice-input.ts', import.meta.url),
      'utf8'
    );
    const imageInputSource = readFileSync(
      new URL('../../apps/mobile/src/input-media.ts', import.meta.url),
      'utf8'
    );
    const imageEditorSource = readFileSync(
      new URL('../../apps/mobile/src/input-image-editor.tsx', import.meta.url),
      'utf8'
    );

    expect(mobilePackage.dependencies?.['expo-image-picker']).toBeTruthy();
    expect(mobilePackage.dependencies?.['expo-image-manipulator']).toBeTruthy();
    expect(mobilePackage.dependencies?.['react-native-view-shot']).toBeTruthy();
    expect(mobilePackage.dependencies?.['expo-localization']).toBeTruthy();
    expect(mobilePackage.dependencies?.['expo-speech-recognition']).toBe('3.1.3');
    expect(plugins).toContain('expo-image-picker');
    expect(plugins).toContain('expo-localization');
    expect(plugins).toContain('expo-speech-recognition');
    expect(imageInputSource).toContain('selectionLimit: 0');
    expect(imageInputSource).toContain('format: SaveFormat.JPEG');
    expect(imageEditorSource).toContain('captureRef');
    expect(imageEditorSource).toContain('cropMobileInputImage');
    expect(voiceInputSource).toContain('contextualStrings: speechContextualStrings');
    expect(voiceInputSource).toContain("iosTaskHint: 'dictation'");
  });
});
