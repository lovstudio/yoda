import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import {
  buildSparkleHelperArgs,
  MacSparkleUpdater,
  parseSparkleHelperEvent,
  resolveSparkleRuntimePaths,
} from './mac-sparkle-updater';

describe('resolveSparkleRuntimePaths', () => {
  it('locates the embedded helper from the packaged executable', () => {
    expect(resolveSparkleRuntimePaths('/Applications/Yoda.app/Contents/MacOS/Yoda')).toEqual({
      appBundlePath: '/Applications/Yoda.app',
      helperPath: '/Applications/Yoda.app/Contents/Helpers/YodaSparkleUpdater',
    });
  });
});

describe('buildSparkleHelperArgs', () => {
  it('downloads and stages without installing', () => {
    const args = buildSparkleHelperArgs(
      '/Applications/Yoda.app',
      'http://127.0.0.1:1234/appcast.xml',
      'download'
    );
    expect(args[0]).toBe('/Applications/Yoda.app');
    expect(args).toContain('--defer-install');
    expect(args).toContain('--check-immediately');
  });

  it('resumes installation without defer mode', () => {
    const args = buildSparkleHelperArgs(
      '/Applications/Yoda.app',
      'http://127.0.0.1:1234/appcast.xml',
      'install'
    );
    expect(args).not.toContain('--defer-install');
  });
});

describe('parseSparkleHelperEvent', () => {
  it('parses structured delta progress', () => {
    expect(
      parseSparkleHelperEvent(
        'YODA_EVENT {"type":"download-progress","transferred":512,"total":1024}'
      )
    ).toEqual({ type: 'download-progress', transferred: 512, total: 1024 });
  });

  it('parses the full-update tripwire', () => {
    expect(
      parseSparkleHelperEvent('prefix YODA_EVENT {"type":"full-update-blocked","version":"0.16.0"}')
    ).toEqual({ type: 'full-update-blocked', version: '0.16.0' });
  });

  it('parses the native install handoff', () => {
    expect(parseSparkleHelperEvent('YODA_EVENT {"type":"installing"}')).toEqual({
      type: 'installing',
    });
  });

  it('rejects malformed markers', () => {
    expect(parseSparkleHelperEvent('YODA_EVENT nope')).toBeNull();
    expect(
      parseSparkleHelperEvent('YODA_EVENT {"type":"update-found","version":1,"delta":true}')
    ).toBeNull();
  });
});

describe('MacSparkleUpdater.check', () => {
  it('passes the update check abort signal to the Electron session fetch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'yoda-sparkle-check-'));
    const appBundlePath = join(root, 'Yoda.app');
    const executablePath = join(appBundlePath, 'Contents', 'MacOS', 'Yoda');
    const helperPath = join(appBundlePath, 'Contents', 'Helpers', 'YodaSparkleUpdater');
    mkdirSync(join(appBundlePath, 'Contents', 'MacOS'), { recursive: true });
    mkdirSync(join(appBundlePath, 'Contents', 'Helpers'), { recursive: true });
    writeFileSync(executablePath, '');
    writeFileSync(helperPath, '');

    try {
      const updater = new MacSparkleUpdater({ arch: 'arm64', executablePath });
      const controller = new AbortController();
      const fetch = vi.fn(() =>
        Promise.resolve(
          new Response('<item><sparkle:version>0.16.0</sparkle:version></item>', { status: 200 })
        )
      );
      const updateSession = { fetch } as unknown as Session;

      await expect(
        updater.check('https://updates.test', '0.16.0', updateSession, controller.signal)
      ).resolves.toBeNull();

      expect(fetch).toHaveBeenCalledWith(
        'https://updates.test/appcast-arm64.xml',
        expect.objectContaining({ signal: controller.signal })
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
