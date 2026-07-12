import { describe, expect, it } from 'vitest';
import {
  parseSparkleArchiveHistory,
  qualifySparkleDeltaArtifacts,
  removeSparkleDeltaEligibilityHints,
  sparkleHistoryFallbackUrl,
  validateGeneratedSparkleAppcast,
} from '@root/scripts/release/lib/sparkle-feed';

const appcast = `<?xml version="1.0"?>
<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <item>
      <sparkle:version>0.16.0</sparkle:version>
      <enclosure url="https://releases.test/yoda-0.16.0-arm64.zip" length="1000" sparkle:edSignature="full-signature" />
      <sparkle:deltas>
        <enclosure url="https://releases.test/yoda-0.15.3-to-0.16.0-arm64.delta" length="100" sparkle:deltaFrom="0.15.3" sparkle:edSignature="delta-signature" />
      </sparkle:deltas>
    </item>
    <item>
      <sparkle:version>0.15.3</sparkle:version>
      <enclosure url="https://releases.test/yoda-0.15.3-arm64.zip" length="900" sparkle:edSignature="old-signature" />
    </item>
  </channel>
</rss>`;

describe('Sparkle release feed', () => {
  it('extracts versioned full archives without confusing deltas for archives', () => {
    expect(parseSparkleArchiveHistory(appcast)).toEqual([
      {
        version: '0.16.0',
        url: 'https://releases.test/yoda-0.16.0-arm64.zip',
        fileName: 'yoda-0.16.0-arm64.zip',
      },
      {
        version: '0.15.3',
        url: 'https://releases.test/yoda-0.15.3-arm64.zip',
        fileName: 'yoda-0.15.3-arm64.zip',
      },
    ]);
  });

  it('requires signed full and exact signed delta artifacts', () => {
    expect(() => validateGeneratedSparkleAppcast(appcast, '0.16.0', ['0.15.3'])).not.toThrow();
    expect(() => validateGeneratedSparkleAppcast(appcast, '0.16.0', ['0.15.2'])).toThrow(
      'No signed delta from 0.15.2 to 0.16.0'
    );
    expect(() =>
      validateGeneratedSparkleAppcast(
        appcast.replace(' sparkle:edSignature="full-signature"', ''),
        '0.16.0',
        ['0.15.3']
      )
    ).toThrow('full archive is unsigned');
  });

  it('publishes architecture-qualified delta names without changing signatures', () => {
    const collisionProneAppcast = appcast.replace(
      'yoda-0.15.3-to-0.16.0-arm64.delta',
      'Yoda0.16.0-0.15.3.delta'
    );
    const result = qualifySparkleDeltaArtifacts(collisionProneAppcast, 'arm64', [
      'Yoda0.16.0-0.15.3.delta',
    ]);

    expect(result.artifacts).toEqual([
      {
        source: 'Yoda0.16.0-0.15.3.delta',
        published: 'Yoda0.16.0-0.15.3-arm64.delta',
      },
    ]);
    expect(result.content).toContain('Yoda0.16.0-0.15.3-arm64.delta');
    expect(result.content).toContain('sparkle:edSignature="delta-signature"');
  });

  it('removes brittle delta eligibility hints without changing signed artifact metadata', () => {
    const hinted = appcast.replace(
      'sparkle:deltaFrom="0.15.3"',
      'sparkle:deltaFrom="0.15.3" sparkle:deltaFromSparkleExecutableSize="977760" sparkle:deltaFromSparkleLocales="de,ja"'
    );

    const result = removeSparkleDeltaEligibilityHints(hinted);

    expect(result).not.toContain('deltaFromSparkleExecutableSize');
    expect(result).not.toContain('deltaFromSparkleLocales');
    expect(result).toContain('sparkle:deltaFrom="0.15.3"');
    expect(result).toContain('sparkle:edSignature="delta-signature"');
  });

  it('falls back to the matching GitHub release when a history mirror is stale', () => {
    expect(
      sparkleHistoryFallbackUrl('lovstudio/yoda', {
        version: '0.15.4',
        url: 'https://releases.example/yoda/yoda-0.15.4-arm64.zip',
        fileName: 'yoda-0.15.4-arm64.zip',
      })
    ).toBe('https://github.com/lovstudio/yoda/releases/download/v0.15.4/yoda-0.15.4-arm64.zip');
  });
});
