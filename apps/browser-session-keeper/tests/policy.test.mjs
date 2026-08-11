import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDiagnostics,
  classifyNavigation,
  evolveProbeStatus,
  nextDelayMinutes,
  normalizeTarget,
  sanitizeDetail,
  sanitizeUrl,
  shouldNotifyTransition,
} from '../policy.js';

test('classifies a protected page on the expected origin as fresh', () => {
  assert.deepEqual(
    classifyNavigation({
      probeUrl: 'https://console.example.com/account',
      finalUrl: 'https://console.example.com/account?from=probe',
      loginUrlPatterns: ['/login', 'passport.example.com'],
    }),
    { state: 'fresh', detail: '受保护页面仍停留在预期站点。' }
  );
});

test('does not treat an unrecognized same-origin redirect as fresh', () => {
  assert.deepEqual(
    classifyNavigation({
      probeUrl: 'https://console.example.com/account',
      finalUrl: 'https://console.example.com/home',
      loginUrlPatterns: ['/login'],
    }),
    { state: 'unknown', detail: '页面留在同一站点，但离开了已配置的受保护路径。' }
  );
});

test('classifies configured login redirects before comparing origins', () => {
  assert.equal(
    classifyNavigation({
      probeUrl: 'https://console.example.com/account',
      finalUrl: 'https://passport.example.com/login?return=https%3A%2F%2Fconsole.example.com',
      loginUrlPatterns: ['passport.example.com/login'],
    }).state,
    'auth_required'
  );
});

test('keeps unrecognized cross-origin redirects explicit', () => {
  assert.equal(
    classifyNavigation({
      probeUrl: 'https://console.example.com/account',
      finalUrl: 'https://sso.example.net/continue',
      loginUrlPatterns: ['/login'],
    }).state,
    'unknown'
  );
});

test('normalizes target intervals and rejects likely credential query parameters', () => {
  const target = normalizeTarget({
    id: 'target-1',
    name: '  控制台  ',
    probeUrl: 'https://console.example.com/account#section',
    intervalMinutes: 0.2,
    loginUrlPatterns: '/login, /signin\n/login',
  });
  assert.equal(target.name, '控制台');
  assert.equal(target.intervalMinutes, 1);
  assert.equal(target.enabled, false);
  assert.deepEqual(target.loginUrlPatterns, ['/login', '/signin']);
  assert.equal(target.probeUrl, 'https://console.example.com/account');

  assert.throws(
    () =>
      normalizeTarget({
        id: 'target-2',
        name: '危险链接',
        probeUrl: 'https://example.com/account?access_token=secret',
        loginUrlPatterns: '/login',
      }),
    /疑似凭证参数/
  );
  assert.throws(
    () =>
      normalizeTarget({
        id: 'target-3',
        name: '危险链接',
        probeUrl: 'https://example.com/account?authCode=secret',
        loginUrlPatterns: '/login',
      }),
    /疑似凭证参数/
  );
});

test('sanitizes diagnostic URLs without query strings or fragments', () => {
  assert.equal(
    sanitizeUrl('https://example.com/account?token=hidden#section'),
    'https://example.com/account'
  );
  assert.equal(
    sanitizeDetail('request https://example.com/account?token=hidden access_token=hidden-value'),
    'request https://example.com/account access_token=[redacted]'
  );
});

test('adds bounded jitter without dropping below one minute', () => {
  assert.equal(
    nextDelayMinutes(5, () => 0),
    4.5
  );
  assert.equal(
    nextDelayMinutes(5, () => 1),
    5.5
  );
  assert.equal(
    nextDelayMinutes(1, () => 0),
    1
  );
});

test('tracks freshness evidence and only notifies on auth transitions', () => {
  const first = evolveProbeStatus(
    null,
    { state: 'fresh', detail: 'ok', finalUrl: 'https://example.com/a?secret=1' },
    '2026-08-11T10:00:00.000Z'
  );
  const second = evolveProbeStatus(
    first,
    { state: 'fresh', detail: 'ok', finalUrl: 'https://example.com/a?secret=2' },
    '2026-08-11T10:05:00.000Z'
  );
  const expired = evolveProbeStatus(
    second,
    {
      state: 'auth_required',
      detail: 'login',
      finalUrl: 'https://example.com/login?code=hidden',
      handoffTabId: 42,
    },
    '2026-08-11T10:10:00.000Z'
  );

  assert.equal(second.consecutiveFresh, 2);
  assert.equal(second.firstFreshAt, '2026-08-11T10:00:00.000Z');
  assert.equal(expired.finalUrl, 'https://example.com/login');
  assert.equal(shouldNotifyTransition(second, expired), true);
  assert.equal(shouldNotifyTransition(expired, expired), false);
});

test('diagnostics never include query values or tab identifiers', () => {
  const diagnostics = buildDiagnostics(
    {
      id: 'target-1',
      name: '控制台',
      probeUrl: 'https://example.com/account?view=private',
      intervalMinutes: 5,
      enabled: true,
    },
    {
      state: 'auth_required',
      detail: 'login',
      checkedAt: '2026-08-11T10:00:00.000Z',
      finalUrl: 'https://example.com/login?code=secret',
      firstFreshAt: null,
      lastFreshAt: null,
      consecutiveFresh: 0,
      lastStatusChangedAt: '2026-08-11T10:00:00.000Z',
      handoffTabId: 99,
    }
  );
  const output = JSON.stringify(diagnostics);
  assert.equal(output.includes('secret'), false);
  assert.equal(output.includes('view=private'), false);
  assert.equal(output.includes('99'), false);
  assert.equal(diagnostics.status.hasHandoffTab, true);
});
