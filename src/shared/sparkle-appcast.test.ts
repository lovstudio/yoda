import { describe, expect, it } from 'vitest';
import {
  compareReleaseVersions,
  findAvailableSparkleUpdate,
  findRequiredSparkleDelta,
  SparkleDeltaRequiredError,
  sparkleFeedUrlForArch,
} from './sparkle-appcast';

const appcast = `<?xml version="1.0" encoding="utf-8"?>
<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" version="2.0">
  <channel>
    <item>
      <title>Version 0.16.0</title>
      <sparkle:version>0.16.0</sparkle:version>
      <enclosure url="https://example.test/yoda-arm64.zip" length="140000000" />
      <sparkle:deltas>
        <enclosure url="https://example.test/yoda-0.15.3-to-0.16.0-arm64.delta" sparkle:deltaFrom="0.15.3" length="123456" sparkle:edSignature="signed" />
      </sparkle:deltas>
    </item>
  </channel>
</rss>`;

describe('sparkleFeedUrlForArch', () => {
  it('selects an architecture-specific appcast', () => {
    expect(sparkleFeedUrlForArch('https://releases.example/yoda/', 'arm64')).toBe(
      'https://releases.example/yoda/appcast-arm64.xml'
    );
    expect(sparkleFeedUrlForArch('https://releases.example/yoda', 'x64')).toBe(
      'https://releases.example/yoda/appcast-x64.xml'
    );
  });

  it('rejects unsupported architectures', () => {
    expect(() => sparkleFeedUrlForArch('https://releases.example/yoda', 'ia32')).toThrow(
      'Unsupported macOS update architecture'
    );
  });
});

describe('findRequiredSparkleDelta', () => {
  it('returns only the exact delta for the installed version', () => {
    expect(findRequiredSparkleDelta(appcast, '0.15.3')).toEqual({
      fromVersion: '0.15.3',
      toVersion: '0.16.0',
      url: 'https://example.test/yoda-0.15.3-to-0.16.0-arm64.delta',
      length: 123456,
      edSignature: 'signed',
    });
  });

  it('fails closed when no exact delta exists', () => {
    expect(() => findRequiredSparkleDelta(appcast, '0.15.2')).toThrowError(
      new SparkleDeltaRequiredError('No signed delta from 0.15.2 to 0.16.0')
    );
  });

  it('rejects unsigned deltas', () => {
    expect(() =>
      findRequiredSparkleDelta(appcast.replace(' sparkle:edSignature="signed"', ''), '0.15.3')
    ).toThrowError(new SparkleDeltaRequiredError('Delta from 0.15.3 to 0.16.0 is unsigned'));
  });

  it('rejects non-delta artifact URLs', () => {
    expect(() =>
      findRequiredSparkleDelta(
        appcast.replace('yoda-0.15.3-to-0.16.0-arm64.delta', 'yoda-arm64.zip'),
        '0.15.3'
      )
    ).toThrowError(
      new SparkleDeltaRequiredError('Delta from 0.15.3 to 0.16.0 has a non-delta URL')
    );
  });
});

describe('findAvailableSparkleUpdate', () => {
  it('returns null when the appcast is not newer', () => {
    expect(findAvailableSparkleUpdate(appcast, '0.16.0')).toBeNull();
    expect(findAvailableSparkleUpdate(appcast, '0.17.0')).toBeNull();
  });

  it('fails closed when a newer release has no exact delta', () => {
    expect(() => findAvailableSparkleUpdate(appcast, '0.15.2')).toThrow(
      'No signed delta from 0.15.2 to 0.16.0'
    );
  });
});

describe('compareReleaseVersions', () => {
  it('uses semantic ordering for release versions', () => {
    expect(compareReleaseVersions('0.16.0', '0.15.10')).toBeGreaterThan(0);
    expect(compareReleaseVersions('0.16.0', '0.16.0-beta.2')).toBeGreaterThan(0);
    expect(compareReleaseVersions('0.16.0-beta.10', '0.16.0-beta.2')).toBeGreaterThan(0);
    expect(compareReleaseVersions('v0.16.0+build.2', '0.16.0')).toBe(0);
  });
});
