import type { Session } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { rewriteSparkleEnclosureUrls, startSparkleFeedProxy } from './sparkle-feed-proxy';

describe('rewriteSparkleEnclosureUrls', () => {
  it('allows only the verified delta through its closed local map', () => {
    const input = `
      <enclosure url="https://downloads.test/Yoda.zip?x=1&amp;y=2" length="100" />
      <sparkle:deltas>
        <enclosure sparkle:deltaFrom="0.15.3" url='https://downloads.test/Yoda.delta' />
      </sparkle:deltas>`;

    const result = rewriteSparkleEnclosureUrls(
      input,
      'http://127.0.0.1:43123',
      'https://downloads.test/Yoda.delta'
    );

    expect(result.appcast).not.toContain('https://downloads.test');
    expect(result.appcast).toContain('http://127.0.0.1:43123/full-update-disabled');
    expect(
      result.appcast.match(/http:\/\/127\.0\.0\.1:43123\/artifact\/[a-f0-9]{64}\.delta/g)
    ).toHaveLength(1);
    expect([...result.artifacts.values()]).toEqual(['https://downloads.test/Yoda.delta']);
  });

  it('rejects an insecure enclosure before starting the helper', () => {
    expect(() =>
      rewriteSparkleEnclosureUrls(
        '<enclosure url="http://downloads.test/Yoda.delta" />',
        'http://127.0.0.1:43123',
        'http://downloads.test/Yoda.delta'
      )
    ).toThrow('Sparkle enclosure must use HTTPS');
  });

  it('never exposes the full artifact through the local server', async () => {
    const deltaUrl = 'https://downloads.test/Yoda.delta';
    const sessionFetch = vi.fn(async () => {
      return new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Length': '3' },
      });
    });
    const updateSession = { fetch: sessionFetch } as unknown as Session;
    const proxy = await startSparkleFeedProxy(
      `<item>
        <enclosure url="https://downloads.test/Yoda.zip" />
        <sparkle:deltas><enclosure url="${deltaUrl}" /></sparkle:deltas>
      </item>`,
      deltaUrl,
      updateSession
    );

    try {
      const appcast = await (await fetch(proxy.feedUrl)).text();
      const fullUrl = /url="([^"]*full-update-disabled)"/.exec(appcast)?.[1];
      const deltaProxyUrl = /url="([^"]*\/artifact\/[a-f0-9]{64}\.delta)"/.exec(appcast)?.[1];
      expect(fullUrl).toBeTruthy();
      expect(deltaProxyUrl).toBeTruthy();
      if (!fullUrl || !deltaProxyUrl) throw new Error('Proxy URLs were not generated');
      expect((await fetch(fullUrl)).status).toBe(404);
      expect([...new Uint8Array(await (await fetch(deltaProxyUrl)).arrayBuffer())]).toEqual([
        1, 2, 3,
      ]);
      expect(sessionFetch).toHaveBeenCalledTimes(1);
      expect(sessionFetch).toHaveBeenCalledWith(
        deltaUrl,
        expect.objectContaining({ method: 'GET' })
      );
    } finally {
      await proxy.close();
    }
  });
});
