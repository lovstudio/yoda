import { describe, expect, it } from 'vitest';
import { MAAS_PLATFORMS } from '@shared/maas';
import {
  extractMaasPlatformDescription,
  extractMaasPlatformInfoSnapshot,
  MAAS_PLATFORM_INFO_SNAPSHOT_VERSION,
} from './platform-description';

describe('MaaS platform description extraction', () => {
  it('uses a suitable official meta description before reading body text', () => {
    const result = extractMaasPlatformDescription({
      platform: MAAS_PLATFORMS.zenmux,
      sourceUrl: 'https://zenmux.ai/docs/',
      fetchedAt: '2026-06-30T00:00:00.000Z',
      html: `
        <html>
          <head>
            <meta name="description" content="ZenMux provides a unified AI model API for routing requests across multiple providers.">
          </head>
          <body>
            <main><p>ZenMux body copy should not be needed when meta is useful.</p></main>
          </body>
        </html>
      `,
    });

    expect(result.source).toBe('official-meta');
    expect(result.description).toBe(
      'ZenMux provides a unified AI model API for routing requests across multiple providers.'
    );
    expect(result.metaDescription).toContain('unified AI model API');
    expect(result.bodyTextExcerpt).toBeNull();
  });

  it('keeps full body text in the provider info snapshot for later review', () => {
    const result = extractMaasPlatformInfoSnapshot({
      platform: MAAS_PLATFORMS.zenmux,
      sourceUrl: 'https://zenmux.ai/docs/',
      fetchedAt: '2026-06-30T00:00:00.000Z',
      html: `
        <html>
          <head>
            <meta name="description" content="ZenMux provides a unified AI model API for routing requests across multiple providers.">
          </head>
          <body>
            <main>
              <h1>ZenMux</h1>
              <p>ZenMux routes AI model calls through a unified API and provider management layer.</p>
            </main>
          </body>
        </html>
      `,
    });

    expect(result.version).toBe(MAAS_PLATFORM_INFO_SNAPSHOT_VERSION);
    expect(result.source).toBe('official-meta');
    expect(result.bodyText).toContain('ZenMux routes AI model calls');
    expect(result.bodyCharCount).toBe(result.bodyText?.length);
  });

  it('summarizes official body text when meta is missing or unsuitable', () => {
    const result = extractMaasPlatformDescription({
      platform: MAAS_PLATFORMS.openrouter,
      sourceUrl: 'https://openrouter.ai/docs',
      fetchedAt: '2026-06-30T00:00:00.000Z',
      html: `
        <html>
          <head><meta name="description" content="Documentation"></head>
          <body>
            <nav>Docs Pricing Login</nav>
            <main>
              <h1>OpenRouter</h1>
              <p>OpenRouter routes requests to AI models and providers through a single API, with model discovery and provider routing.</p>
              <p>Additional documentation can be long and detailed.</p>
            </main>
          </body>
        </html>
      `,
    });

    expect(result.source).toBe('official-body-summary');
    expect(result.description).toContain('OpenRouter routes requests to AI models');
    expect(result.metaDescription).toBeNull();
    expect(result.bodySummary).toContain('single API');
    expect(result.bodyTextExcerpt).toContain('OpenRouter');
    expect(result.bodyCharCount).toBeGreaterThan(100);
  });

  it('rejects generic code-like meta text even when it contains router/API terms', () => {
    const result = extractMaasPlatformDescription({
      platform: MAAS_PLATFORMS.zenmux,
      sourceUrl: 'https://zenmux.ai/docs/',
      fetchedAt: '2026-06-30T00:00:00.000Z',
      html: `
        <html>
          <head><meta name="description" content="const router = useRouter()..."></head>
          <body>
            <main>
              <p>ZenMux provides a unified API standard for invoking AI models from different providers.</p>
            </main>
          </body>
        </html>
      `,
    });

    expect(result.source).toBe('official-body-summary');
    expect(result.description).toContain('ZenMux provides a unified API standard');
    expect(result.metaDescription).toBeNull();
  });

  it('falls back when neither meta nor body contains a useful product description', () => {
    const result = extractMaasPlatformDescription({
      platform: MAAS_PLATFORMS.siliconflow,
      sourceUrl: 'https://docs.siliconflow.cn/',
      fetchedAt: '2026-06-30T00:00:00.000Z',
      html: '<html><head></head><body><main><p>Docs Pricing Login</p></main></body></html>',
    });

    expect(result.source).toBe('fallback');
    expect(result.description).toBe(MAAS_PLATFORMS.siliconflow.description);
    expect(result.error).toBe('No usable page description found.');
  });
});
