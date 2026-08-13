import { describe, expect, it } from 'vitest';
import { extractMaasProfileWebsiteMetadata } from './profile-website-metadata';

describe('MaaS profile website metadata extraction', () => {
  it('extracts product identity from one homepage document and resolves its logo', () => {
    const result = extractMaasProfileWebsiteMetadata(
      `
        <html>
          <head>
            <title>Fallback title</title>
            <meta name="description" content="Fallback description">
            <script type="application/ld+json">
              {
                "@type": "Organization",
                "name": "ZenMux",
                "description": "The Enterprise LLM Platform. Unified API for 100+ AI models.",
                "logo": "/brand/big-logo.svg"
              }
            </script>
          </head>
        </html>
      `,
      'https://zenmux.ai/'
    );

    expect(result).toEqual({
      websiteUrl: 'https://zenmux.ai/',
      name: 'ZenMux',
      description: 'The Enterprise LLM Platform. Unified API for 100+ AI models.',
      logoUrl: 'https://zenmux.ai/brand/big-logo.svg',
    });
  });

  it('falls back to Open Graph, title, and icons without inventing missing data', () => {
    const result = extractMaasProfileWebsiteMetadata(
      `
        <html><head>
          <title>Example AI — Developer Platform</title>
          <meta property="og:description" content="One API for useful AI models.">
          <link rel="icon" href="favicon.svg">
        </head></html>
      `,
      'https://example.test/platform'
    );

    expect(result.name).toBe('Example AI');
    expect(result.description).toBe('One API for useful AI models.');
    expect(result.logoUrl).toBe('https://example.test/favicon.svg');
  });

  it('rejects non-http logo schemes', () => {
    const result = extractMaasProfileWebsiteMetadata(
      '<meta property="og:site_name" content="Unsafe"><link rel="icon" href="data:image/svg+xml,x">',
      'https://example.test/'
    );
    expect(result.logoUrl).toBeNull();
  });
});
