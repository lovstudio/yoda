import {
  BROWSER_SESSION_HEALTH_CONFIG_VERSION,
  type BrowserSessionHealthAttention,
  type BrowserSessionHealthAttentionState,
  type BrowserSessionHealthConfig,
  type BrowserSessionHealthDiagnostic,
  type BrowserSessionHealthTarget,
  type BrowserSessionHealthTargetInput,
  type BrowserSessionHealthTargetState,
  type BrowserSessionHealthTargetStatus,
} from '@shared/browser-session-health';

export const MIN_BROWSER_SESSION_HEALTH_INTERVAL_MINUTES = 1;
export const MAX_BROWSER_SESSION_HEALTH_INTERVAL_MINUTES = 24 * 60;
export const DEFAULT_BROWSER_SESSION_HEALTH_INTERVAL_MINUTES = 15;
export const BROWSER_SESSION_HEALTH_JITTER_RATIO = 0.1;

const SENSITIVE_ASSIGNMENT =
  /\b(access[_-]?token|api[_-]?key|auth(?:orization|code|token)?|cookie|credential|password|secret|session(?:id)?|signature|token)\s*[=:]\s*[^\s,;]+/gi;
const URL_IN_TEXT = /https?:\/\/[^\s"'<>]+/gi;

export const DEFAULT_BROWSER_SESSION_HEALTH_CONFIG: BrowserSessionHealthConfig = {
  version: BROWSER_SESSION_HEALTH_CONFIG_VERSION,
  enabled: false,
  targets: [],
};

export interface BrowserSessionNavigationOutcome {
  state: Extract<
    BrowserSessionHealthTargetState,
    'fresh' | 'auth_required' | 'needs_human' | 'network_error' | 'unknown'
  >;
  finalUrl: string | null;
}

export function sanitizeBrowserSessionUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? '').trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return `${url.origin}${normalizePathname(url.pathname)}`;
  } catch {
    return null;
  }
}

export function redactBrowserSessionDiagnostic(value: unknown): string {
  return String(value ?? '')
    .slice(0, 800)
    .replace(URL_IN_TEXT, (url) => sanitizeBrowserSessionUrl(url) ?? 'invalid://')
    .replace(SENSITIVE_ASSIGNMENT, '$1=[redacted]')
    .replace(/[?#][^\s"'<>]*/g, '')
    .slice(0, 500);
}

function normalizePathname(pathname: string): string {
  if (!pathname) return '/';
  const collapsed = pathname.replace(/\/{2,}/g, '/');
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : collapsed;
}

function normalizeConfiguredUrl(value: unknown): string {
  let parsed: URL;
  try {
    parsed = new URL(String(value ?? '').trim());
  } catch {
    throw new Error('只读页面网址格式有误。');
  }
  const localHttp =
    parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !localHttp) {
    throw new Error('只读页面必须使用 HTTPS；本机 localhost 可使用 HTTP。');
  }
  if (parsed.username || parsed.password) {
    throw new Error('只读页面网址中不应包含账号或凭证。');
  }
  return `${parsed.origin}${normalizePathname(parsed.pathname)}`;
}

function normalizePattern(value: unknown): string | null {
  const trimmed = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!trimmed) return null;
  const withoutFragment = trimmed.split('#', 1)[0] ?? '';
  const withoutQuery = withoutFragment.split('?', 1)[0] ?? '';
  const redacted = redactBrowserSessionDiagnostic(withoutQuery).trim();
  return redacted || null;
}

function normalizePatterns(values: unknown, aliases: unknown[] = []): string[] {
  const raw = Array.isArray(values)
    ? values
    : typeof values === 'string'
      ? values.split(/[\n,]/)
      : [];
  const normalized = [...raw, ...aliases]
    .map(normalizePattern)
    .filter((value): value is string => value !== null);
  return [...new Set(normalized)];
}

export function normalizeBrowserSessionHealthTarget(
  input: BrowserSessionHealthTargetInput,
  id: string
): BrowserSessionHealthTarget {
  const name = String(input.name ?? '').trim();
  if (!name) throw new Error('请填写目标名称。');
  const normalizedId = String(id).trim();
  if (!normalizedId || !/^[a-zA-Z0-9._-]+$/.test(normalizedId)) {
    throw new Error('目标标识无效。');
  }
  const requestedInterval = Number(
    input.intervalMinutes ?? DEFAULT_BROWSER_SESSION_HEALTH_INTERVAL_MINUTES
  );
  if (!Number.isFinite(requestedInterval)) throw new Error('检查间隔必须是数字。');
  const intervalMinutes = Math.min(
    MAX_BROWSER_SESSION_HEALTH_INTERVAL_MINUTES,
    Math.max(MIN_BROWSER_SESSION_HEALTH_INTERVAL_MINUTES, Math.round(requestedInterval * 10) / 10)
  );

  return {
    id: normalizedId,
    name,
    url: normalizeConfiguredUrl(input.url),
    enabled: input.enabled === true,
    intervalMinutes,
    loginUrlPatterns: normalizePatterns(input.loginUrlPatterns, [input.loginUrlMarker]),
    loginTitlePatterns: normalizePatterns(input.loginTitlePatterns, [input.loginTitleMarker]),
    humanUrlPatterns: normalizePatterns(input.humanUrlPatterns),
    humanTitlePatterns: normalizePatterns(input.humanTitlePatterns),
  };
}

function includesPattern(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

export function classifyBrowserSessionNavigation(
  target: BrowserSessionHealthTarget,
  finalUrlValue: unknown,
  titleValue: unknown
): BrowserSessionNavigationOutcome {
  const rawFinalUrl = String(finalUrlValue ?? '').trim();
  if (!rawFinalUrl || /^(?:about|chrome-error|data):/i.test(rawFinalUrl)) {
    return { state: 'network_error', finalUrl: sanitizeBrowserSessionUrl(rawFinalUrl) };
  }

  const comparableUrl = (sanitizeBrowserSessionUrl(rawFinalUrl) ?? '').toLowerCase();
  const comparableTitle = String(titleValue ?? '')
    .trim()
    .toLowerCase();
  const defaultHumanUrlPatterns = ['/captcha', '/challenge', '/risk', '/verify', '/verification'];
  const defaultHumanTitlePatterns = [
    '验证码',
    '安全验证',
    '风险',
    'captcha',
    'challenge',
    'verification required',
  ];

  if (
    includesPattern(comparableUrl, [...target.humanUrlPatterns, ...defaultHumanUrlPatterns]) ||
    includesPattern(comparableTitle, [...target.humanTitlePatterns, ...defaultHumanTitlePatterns])
  ) {
    return { state: 'needs_human', finalUrl: sanitizeBrowserSessionUrl(rawFinalUrl) };
  }
  if (
    includesPattern(comparableUrl, target.loginUrlPatterns) ||
    includesPattern(comparableTitle, target.loginTitlePatterns)
  ) {
    return { state: 'auth_required', finalUrl: sanitizeBrowserSessionUrl(rawFinalUrl) };
  }

  try {
    const expected = new URL(target.url);
    const actual = new URL(rawFinalUrl);
    if (
      expected.origin === actual.origin &&
      normalizePathname(expected.pathname) === normalizePathname(actual.pathname)
    ) {
      return { state: 'fresh', finalUrl: sanitizeBrowserSessionUrl(rawFinalUrl) };
    }
  } catch {
    return { state: 'network_error', finalUrl: null };
  }
  return { state: 'unknown', finalUrl: sanitizeBrowserSessionUrl(rawFinalUrl) };
}

export function nextBrowserSessionHealthDelayMs(
  intervalMinutes: number,
  random: () => number = Math.random
): number {
  const requestedInterval = Number(intervalMinutes);
  const interval = Math.min(
    MAX_BROWSER_SESSION_HEALTH_INTERVAL_MINUTES,
    Math.max(
      MIN_BROWSER_SESSION_HEALTH_INTERVAL_MINUTES,
      Number.isFinite(requestedInterval)
        ? requestedInterval
        : DEFAULT_BROWSER_SESSION_HEALTH_INTERVAL_MINUTES
    )
  );
  const randomValue = Math.min(1, Math.max(0, Number(random()) || 0));
  const factor =
    1 - BROWSER_SESSION_HEALTH_JITTER_RATIO + 2 * BROWSER_SESSION_HEALTH_JITTER_RATIO * randomValue;
  return Math.max(60_000, Math.round(interval * 60_000 * factor));
}

export function createBrowserSessionHealthStatus(
  targetId: string
): BrowserSessionHealthTargetStatus {
  return {
    targetId,
    state: 'unknown',
    checkedAt: null,
    stateChangedAt: null,
    lastFreshAt: null,
    consecutiveFresh: 0,
    nextCheckAt: null,
    finalUrl: null,
    handoffUrl: null,
    ownership: 'unknown',
    taskSpaceId: null,
    error: null,
  };
}

export interface BrowserSessionStatusUpdate {
  targetId: string;
  state: BrowserSessionHealthTargetState;
  checkedAt: string;
  nextCheckAt: string | null;
  finalUrl?: string | null;
  handoffUrl?: string | null;
  ownership?: BrowserSessionHealthTargetStatus['ownership'];
  taskSpaceId?: number | null;
  error?: BrowserSessionHealthDiagnostic | null;
}

export function evolveBrowserSessionHealthStatus(
  previous: BrowserSessionHealthTargetStatus | undefined,
  update: BrowserSessionStatusUpdate
): BrowserSessionHealthTargetStatus {
  const current = previous ?? createBrowserSessionHealthStatus(update.targetId);
  const fresh = update.state === 'fresh';
  const attention = isBrowserSessionAttentionState(update.state);
  return {
    targetId: update.targetId,
    state: update.state,
    checkedAt: update.checkedAt,
    stateChangedAt:
      current.state === update.state
        ? (current.stateChangedAt ?? update.checkedAt)
        : update.checkedAt,
    lastFreshAt: fresh ? update.checkedAt : current.lastFreshAt,
    consecutiveFresh: fresh ? (current.state === 'fresh' ? current.consecutiveFresh : 0) + 1 : 0,
    nextCheckAt: update.nextCheckAt,
    finalUrl: sanitizeBrowserSessionUrl(update.finalUrl) ?? null,
    handoffUrl: attention
      ? (sanitizeBrowserSessionUrl(update.handoffUrl ?? update.finalUrl) ?? null)
      : null,
    ownership: update.ownership ?? current.ownership,
    taskSpaceId:
      update.taskSpaceId === undefined
        ? current.taskSpaceId
        : Number.isInteger(update.taskSpaceId)
          ? (update.taskSpaceId ?? null)
          : null,
    error: update.error ?? null,
  };
}

export function isBrowserSessionAttentionState(
  state: BrowserSessionHealthTargetState
): state is BrowserSessionHealthAttentionState {
  return state === 'auth_required' || state === 'needs_human';
}

export function isBrowserSessionBlockedState(state: BrowserSessionHealthTargetState): boolean {
  return isBrowserSessionAttentionState(state) || state === 'waiting_user';
}

export function shouldNotifyBrowserSessionTransition(
  previous: BrowserSessionHealthTargetStatus | undefined,
  next: BrowserSessionHealthTargetStatus
): boolean {
  return isBrowserSessionAttentionState(next.state) && previous?.state !== next.state;
}

export function makeBrowserSessionAttention(
  target: BrowserSessionHealthTarget,
  status: BrowserSessionHealthTargetStatus
): BrowserSessionHealthAttention | null {
  if (!isBrowserSessionAttentionState(status.state)) return null;
  const needsVerification = status.state === 'needs_human';
  return {
    targetId: target.id,
    targetName: target.name,
    state: status.state,
    title: needsVerification ? '需要人工验证' : '需要重新登录',
    message: `${target.name}${needsVerification ? '需要在 Ego 中完成验证。' : '的登录状态已失效。'}`,
    at: status.checkedAt ?? new Date(0).toISOString(),
    handoffUrl: status.handoffUrl,
  };
}

export function browserSessionHealthDiagnostic(
  error: unknown,
  operation: BrowserSessionHealthDiagnostic['operation'],
  at: string,
  code?: BrowserSessionHealthDiagnostic['code']
): BrowserSessionHealthDiagnostic {
  const sourceMessage = error instanceof Error ? error.message : String(error ?? '');
  const message = redactBrowserSessionDiagnostic(sourceMessage) || '会话健康检查遇到未知错误。';
  const inferredCode =
    code ??
    (operation === 'handoff'
      ? 'handoff_failed'
      : operation === 'resume'
        ? 'resume_failed'
        : operation === 'store'
          ? 'store_error'
          : 'unknown_error');
  return {
    code: inferredCode,
    message,
    operation,
    at,
    retryable: inferredCode !== 'invalid_response' && inferredCode !== 'ownership_changed',
  };
}
