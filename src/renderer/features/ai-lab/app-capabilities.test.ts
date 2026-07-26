import { describe, expect, it } from 'vitest';
import { appUsesImageEditBridge } from './app-capabilities';

describe('AI Lab app capabilities', () => {
  it('does not enable image activity for an ordinary generated app', () => {
    expect(
      appUsesImageEditBridge(
        '<!doctype html><html><body><main>公众号封面裁切器</main></body></html>'
      )
    ).toBe(false);
  });

  it('enables image activity when the generated app calls the image bridge', () => {
    expect(
      appUsesImageEditBridge(
        '<script>await window.yoda.ai.editImage({ imageDataUrl, prompt })</script>'
      )
    ).toBe(true);
    expect(appUsesImageEditBridge('<script>await yoda?.ai?.editImage(input)</script>')).toBe(true);
  });

  it('does not confuse the error-copy helper with image generation', () => {
    expect(appUsesImageEditBridge('<script>await window.yoda.ai.copyLastError()</script>')).toBe(
      false
    );
  });
});
