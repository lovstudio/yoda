import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_LAB_APP_IMAGE_MODEL } from '@shared/ai-lab-bridge';
import { appImageEditRuntime } from '../app-image-edit-runtime';
import { applySandboxPolicy } from '../sandbox-policy';

describe('AI Lab app sandbox', () => {
  it('denies direct network access and injects the narrow host bridge', () => {
    const source = applySandboxPolicy('<!doctype html><html><head></head><body></body></html>');
    expect(source).toContain("default-src 'none'");
    expect(source).toContain("connect-src 'none'");
    expect(source).toContain("Object.defineProperty(globalThis,'yoda'");
    expect(source).toContain('M="images.edit"');
    expect(source).toContain('E="errors.copyLast"');
    expect(source).toContain('copyLastError');
    expect(source).toContain('parent.postMessage');
    expect(source).not.toContain('apiKey');
    expect(source.indexOf('Content-Security-Policy')).toBeLessThan(source.indexOf('</head>'));
    expect(source.indexOf("Object.defineProperty(globalThis,'yoda'")).toBeLessThan(
      source.indexOf('</head>')
    );
  });
});

describe('app image edit runtime', () => {
  afterEach(() => {
    vi.useRealTimers();
    appImageEditRuntime.reset('app-1');
  });

  it('keeps estimated progress outside the iframe lifecycle', async () => {
    vi.useFakeTimers();
    let resolve!: (result: {
      imageDataUrl: string;
      model: typeof AI_LAB_APP_IMAGE_MODEL;
      historyId: string;
    }) => void;
    const task = new Promise<{
      imageDataUrl: string;
      model: typeof AI_LAB_APP_IMAGE_MODEL;
      historyId: string;
    }>((done) => {
      resolve = done;
    });

    const running = appImageEditRuntime.run('app-1', () => task);
    expect(appImageEditRuntime.getSnapshot('app-1')).toMatchObject({
      status: 'running',
      stage: 'preparing',
      progress: 6,
    });

    await vi.advanceTimersByTimeAsync(2_500);
    expect(appImageEditRuntime.getSnapshot('app-1')).toMatchObject({
      status: 'running',
      stage: 'generating',
    });

    resolve({
      imageDataUrl: 'data:image/png;base64,AA==',
      model: AI_LAB_APP_IMAGE_MODEL,
      historyId: 'history-1',
    });
    await running;
    expect(appImageEditRuntime.getSnapshot('app-1')).toMatchObject({
      status: 'succeeded',
      progress: 100,
      historyId: 'history-1',
    });
  });

  it('deduplicates a second request while one is active', async () => {
    let resolve!: (result: { imageDataUrl: string; model: typeof AI_LAB_APP_IMAGE_MODEL }) => void;
    const task = new Promise<{
      imageDataUrl: string;
      model: typeof AI_LAB_APP_IMAGE_MODEL;
    }>((done) => {
      resolve = done;
    });
    const first = appImageEditRuntime.run('app-1', () => task);
    const secondTask = vi.fn();
    const second = appImageEditRuntime.run('app-1', secondTask);
    expect(second).toBe(first);
    expect(secondTask).not.toHaveBeenCalled();
    resolve({ imageDataUrl: 'data:image/png;base64,AA==', model: AI_LAB_APP_IMAGE_MODEL });
    await first;
  });
});
