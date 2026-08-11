export const MIN_INTERVAL_MINUTES = 1;
export const MAX_INTERVAL_MINUTES = 24 * 60;
export const DEFAULT_INTERVAL_MINUTES = 15;
export const PROBE_TIMEOUT_MS = 30_000;
export const PAGE_SETTLE_MS = 1_500;

const SENSITIVE_QUERY_NAMES = new Set([
  'accesstoken',
  'apikey',
  'auth',
  'authorization',
  'authcode',
  'authtoken',
  'code',
  'credential',
  'key',
  'secret',
  'session',
  'sessionid',
  'sig',
  'signature',
  'token',
]);

function parseHttpUrl(value, label) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new Error(`${label}不是有效网址。`);
  }

  const isLocalHttp = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !isLocalHttp) {
    throw new Error(`${label}必须使用 HTTPS；本机 localhost 可使用 HTTP。`);
  }
  if (url.username || url.password) {
    throw new Error(`${label}里不要包含用户名或密码。`);
  }
  for (const key of url.searchParams.keys()) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (SENSITIVE_QUERY_NAMES.has(normalizedKey)) {
      throw new Error(`${label}包含疑似凭证参数“${key}”，请改用稳定的只读页面地址。`);
    }
  }
  url.hash = '';
  return url;
}

export function sanitizeUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return `${url.origin}${url.pathname}`;
    }
    return `${url.protocol}//`;
  } catch {
    return 'invalid://';
  }
}

export function sanitizeDetail(value) {
  return String(value ?? '')
    .slice(0, 500)
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => sanitizeUrl(url))
    .replace(
      /\b(access[_-]?token|api[_-]?key|auth(?:orization|code|token)?|credential|secret|session(?:id)?|signature|token)\s*[=:]\s*[^\s,;]+/gi,
      '$1=[redacted]'
    );
}

export function normalizeLoginPatterns(value) {
  const values = Array.isArray(value) ? value : String(value ?? '').split(/[\n,]/);
  return [...new Set(values.map((item) => String(item).trim().toLowerCase()).filter(Boolean))];
}

export function normalizeTarget(input) {
  const name = String(input.name ?? '').trim();
  if (!name) throw new Error('请填写名称。');

  const probeUrl = parseHttpUrl(input.probeUrl, '只读页面').toString();
  const loginUrlPatterns = normalizeLoginPatterns(input.loginUrlPatterns);
  if (loginUrlPatterns.length === 0) {
    throw new Error('请至少填写一个登录页标记。');
  }

  const requestedInterval = Number(input.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES);
  if (!Number.isFinite(requestedInterval)) throw new Error('检查间隔必须是数字。');
  const intervalMinutes = Math.min(
    MAX_INTERVAL_MINUTES,
    Math.max(MIN_INTERVAL_MINUTES, Math.round(requestedInterval * 10) / 10)
  );

  return {
    id: String(input.id ?? '').trim(),
    name,
    probeUrl,
    intervalMinutes,
    loginUrlPatterns,
    enabled: input.enabled === true,
  };
}

export function classifyNavigation({ probeUrl, finalUrl, loginUrlPatterns }) {
  const normalizedFinal = String(finalUrl ?? '').trim();
  if (!normalizedFinal) {
    return { state: 'unknown', detail: '页面没有返回可判断的网址。' };
  }
  if (/^(?:chrome-error|about):/i.test(normalizedFinal)) {
    return { state: 'network_error', detail: '页面加载失败。' };
  }

  const comparable = normalizedFinal.toLowerCase();
  const patterns = normalizeLoginPatterns(loginUrlPatterns);
  if (patterns.some((pattern) => comparable.includes(pattern))) {
    return { state: 'auth_required', detail: '页面跳转到了已配置的登录地址。' };
  }

  try {
    const expected = new URL(probeUrl);
    const actual = new URL(normalizedFinal);
    const normalizePathname = (pathname) =>
      pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
    if (
      expected.origin === actual.origin &&
      normalizePathname(expected.pathname) === normalizePathname(actual.pathname)
    ) {
      return { state: 'fresh', detail: '受保护页面仍停留在预期站点。' };
    }
    if (expected.origin === actual.origin) {
      return { state: 'unknown', detail: '页面留在同一站点，但离开了已配置的受保护路径。' };
    }
    return { state: 'unknown', detail: '页面跳转到了未识别的站点。' };
  } catch {
    return { state: 'unknown', detail: '页面返回了不可识别的网址。' };
  }
}

export function nextDelayMinutes(intervalMinutes, random = Math.random) {
  const interval = Math.min(
    MAX_INTERVAL_MINUTES,
    Math.max(MIN_INTERVAL_MINUTES, Number(intervalMinutes) || DEFAULT_INTERVAL_MINUTES)
  );
  const boundedRandom = Math.min(1, Math.max(0, Number(random()) || 0));
  const factor = 0.9 + boundedRandom * 0.2;
  return Math.max(MIN_INTERVAL_MINUTES, Math.round(interval * factor * 10) / 10);
}

export function evolveProbeStatus(previous, outcome, now = new Date().toISOString()) {
  const stateChanged = previous?.state !== outcome.state;
  const isFresh = outcome.state === 'fresh';
  return {
    state: outcome.state,
    detail: sanitizeDetail(outcome.detail),
    checkedAt: now,
    finalUrl: sanitizeUrl(outcome.finalUrl),
    firstFreshAt: isFresh ? (previous?.firstFreshAt ?? now) : (previous?.firstFreshAt ?? null),
    lastFreshAt: isFresh ? now : (previous?.lastFreshAt ?? null),
    consecutiveFresh: isFresh
      ? (previous?.state === 'fresh' ? (previous.consecutiveFresh ?? 0) : 0) + 1
      : 0,
    lastStatusChangedAt: stateChanged ? now : (previous?.lastStatusChangedAt ?? now),
    handoffTabId: outcome.handoffTabId ?? null,
  };
}

export function shouldNotifyTransition(previous, next) {
  return next.state === 'auth_required' && previous?.state !== 'auth_required';
}

export function buildDiagnostics(target, status) {
  return {
    target: {
      id: target.id,
      name: target.name,
      probeUrl: sanitizeUrl(target.probeUrl),
      intervalMinutes: target.intervalMinutes,
      enabled: target.enabled,
    },
    status: status
      ? {
          state: status.state,
          detail: sanitizeDetail(status.detail),
          checkedAt: status.checkedAt,
          finalUrl: sanitizeUrl(status.finalUrl),
          firstFreshAt: status.firstFreshAt,
          lastFreshAt: status.lastFreshAt,
          consecutiveFresh: status.consecutiveFresh,
          lastStatusChangedAt: status.lastStatusChangedAt,
          hasHandoffTab: Number.isInteger(status.handoffTabId),
        }
      : null,
  };
}
