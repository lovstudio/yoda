import { describe, expect, it } from 'vitest';
import type { BrowserSessionHealthTarget } from '@shared/browser-session-health';
import {
  classifyBrowserSessionNavigation,
  createBrowserSessionHealthStatus,
  DEFAULT_BROWSER_SESSION_HEALTH_CONFIG,
  evolveBrowserSessionHealthStatus,
  nextBrowserSessionHealthDelayMs,
  normalizeBrowserSessionHealthTarget,
  redactBrowserSessionDiagnostic,
  sanitizeBrowserSessionUrl,
} from './policy';

function target(overrides: Partial<BrowserSessionHealthTarget> = {}): BrowserSessionHealthTarget {
  return {
    id: 'console',
    name: '控制台',
    url: 'https://console.example.com/account',
    enabled: true,
    intervalMinutes: 10,
    loginUrlPatterns: ['/login', 'passport.example.com'],
    loginTitlePatterns: ['请登录'],
    humanUrlPatterns: ['/security-check'],
    humanTitlePatterns: ['人机验证'],
    ...overrides,
  };
}

describe('browser session health policy', () => {
  it('keeps the source default disabled and product-neutral', () => {
    expect(DEFAULT_BROWSER_SESSION_HEALTH_CONFIG).toEqual({
      version: 1,
      enabled: false,
      targets: [],
    });
  });

  it('normalizes a read-only GET target and removes query and fragment data', () => {
    expect(
      normalizeBrowserSessionHealthTarget(
        {
          name: '  控制台  ',
          url: 'https://console.example.com/account?token=secret#section',
          intervalMinutes: 0.1,
          loginUrlMarker: '/login?return=private',
          loginTitleMarker: '请登录',
        },
        'target-1'
      )
    ).toMatchObject({
      id: 'target-1',
      name: '控制台',
      url: 'https://console.example.com/account',
      enabled: false,
      intervalMinutes: 1,
      loginUrlPatterns: ['/login'],
      loginTitlePatterns: ['请登录'],
    });
  });

  it('classifies only the same origin and pathname as fresh', () => {
    expect(
      classifyBrowserSessionNavigation(
        target(),
        'https://console.example.com/account?renewed=1#top',
        '账户中心'
      ).state
    ).toBe('fresh');
    expect(
      classifyBrowserSessionNavigation(target(), 'https://console.example.com/home', '首页').state
    ).toBe('unknown');
    expect(
      classifyBrowserSessionNavigation(target(), 'https://other.example.net/account', '首页').state
    ).toBe('unknown');
  });

  it('checks login and human-verification URL/title patterns before freshness', () => {
    expect(
      classifyBrowserSessionNavigation(
        target(),
        'https://console.example.com/account',
        '请登录后继续'
      ).state
    ).toBe('auth_required');
    expect(
      classifyBrowserSessionNavigation(
        target(),
        'https://console.example.com/security-check?code=secret',
        '账户'
      ).state
    ).toBe('needs_human');
    expect(
      classifyBrowserSessionNavigation(target(), 'https://console.example.com/account', '验证码')
        .state
    ).toBe('needs_human');
    expect(
      classifyBrowserSessionNavigation(
        target(),
        'https://console.example.com/account?return=%2Flogin#challenge',
        '账户'
      ).state
    ).toBe('fresh');
  });

  it('redacts every persisted URL and copyable diagnostic', () => {
    expect(sanitizeBrowserSessionUrl('https://example.com/a?token=secret#section')).toBe(
      'https://example.com/a'
    );
    const output = redactBrowserSessionDiagnostic(
      'GET https://example.com/a?token=secret#x access_token=hidden password=hunter2'
    );
    expect(output).toBe('GET https://example.com/a access_token=[redacted] password=[redacted]');
    expect(output).not.toContain('secret');
    expect(output).not.toContain('hunter2');
  });

  it('uses bounded interval jitter', () => {
    expect(nextBrowserSessionHealthDelayMs(10, () => 0)).toBe(9 * 60_000);
    expect(nextBrowserSessionHealthDelayMs(10, () => 1)).toBe(11 * 60_000);
    expect(nextBrowserSessionHealthDelayMs(0, () => 0)).toBe(60_000);
  });

  it('evolves freshness and preserves the cached task-space id when omitted', () => {
    const first = evolveBrowserSessionHealthStatus(createBrowserSessionHealthStatus('target-1'), {
      targetId: 'target-1',
      state: 'fresh',
      checkedAt: '2026-08-11T01:00:00.000Z',
      nextCheckAt: '2026-08-11T01:10:00.000Z',
      finalUrl: 'https://example.com/a?private=1',
      ownership: 'agent',
      taskSpaceId: 7,
    });
    const second = evolveBrowserSessionHealthStatus(first, {
      targetId: 'target-1',
      state: 'fresh',
      checkedAt: '2026-08-11T01:10:00.000Z',
      nextCheckAt: '2026-08-11T01:20:00.000Z',
      finalUrl: 'https://example.com/a?private=2',
    });
    expect(second.consecutiveFresh).toBe(2);
    expect(second.taskSpaceId).toBe(7);
    expect(second.finalUrl).toBe('https://example.com/a');
    expect(second.targetId).toBe('target-1');
  });
});
