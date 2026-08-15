/**
 * Gateway usage endpoints sit behind much stricter limits than the inference
 * endpoints they report on — a New API deployment answers `/api/usage/token/`
 * about 20 times per window and then returns `429` with a `Retry-After` of a
 * minute or so. Usage figures are cosmetic, so hitting that limiter must degrade
 * to the last known value instead of surfacing as a failed read.
 */
export class MaasUsageRateLimitError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number | null
  ) {
    super(message);
    this.name = 'MaasUsageRateLimitError';
  }
}

export const MAAS_USAGE_RATE_LIMIT_FALLBACK_MS = 60_000;

export function parseRetryAfterMs(headers: Headers, now = Date.now()): number | null {
  const raw = headers.get('retry-after')?.trim();
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1_000));

  const retryAt = Date.parse(raw);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - now) : null;
}

export function maasUsageRateLimitMessage(provider: string, retryAfterMs: number | null): string {
  const waitSeconds = Math.ceil((retryAfterMs ?? MAAS_USAGE_RATE_LIMIT_FALLBACK_MS) / 1_000);
  return `${provider} usage API is rate limited (HTTP 429). Retry in ${waitSeconds}s.`;
}
