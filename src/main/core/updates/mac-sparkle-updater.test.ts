import { describe, expect, it } from 'vitest';
import {
  buildSparkleHelperArgs,
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
