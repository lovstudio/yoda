import i18n from '@renderer/lib/i18n';

/**
 * Locale-aware display formatting shared by the bar's entries. Quota labels and
 * threshold logic — the parts that are pure data, not presentation — stay in
 * `workspace-runtime-bar-format.ts`.
 *
 * The UI language is the user's choice; the OS locale is not. Every formatter
 * here reads `i18n.language` so a Chinese UI never renders "05:05 PM".
 */
export function formatPopoverTime(value: string): string {
  return new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(value)
  );
}

export function formatUsagePeriod(startingAt: string, endingAt: string): string {
  const formatter = new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' });
  return `${formatter.format(new Date(startingAt))} – ${formatter.format(new Date(endingAt))}`;
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat(i18n.language, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: value >= 100 ? 0 : 4,
  }).format(value);
}

export function formatResetCountdown(value: string): string {
  const remainingMinutes = Math.max(
    0,
    Math.ceil((new Date(value).getTime() - Date.now()) / 60_000)
  );
  const formatter = new Intl.RelativeTimeFormat(i18n.language, {
    numeric: 'always',
    style: 'short',
  });

  if (remainingMinutes < 60) return formatter.format(remainingMinutes, 'minute');

  const remainingHours = Math.ceil(remainingMinutes / 60);
  if (remainingHours < 48) return formatter.format(remainingHours, 'hour');

  return formatter.format(Math.ceil(remainingHours / 24), 'day');
}

/**
 * Past-facing counterpart to {@link formatResetCountdown}: how long ago a
 * reading was taken. Seconds are worth their own step — a just-refreshed figure
 * should read as "now", not as "1 minute ago".
 */
export function formatRelativeTimeSince(value: string): string {
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  const formatter = new Intl.RelativeTimeFormat(i18n.language, {
    numeric: 'auto',
    style: 'short',
  });

  if (elapsedSeconds < 60) return formatter.format(-elapsedSeconds, 'second');

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return formatter.format(-elapsedMinutes, 'minute');

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 48) return formatter.format(-elapsedHours, 'hour');

  return formatter.format(-Math.floor(elapsedHours / 24), 'day');
}

export function formatAccountResetCreditExpiry(value: string): string {
  return new Intl.DateTimeFormat(i18n.language, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

/** Full date + time, for the tooltip behind an abbreviated reading. */
export function formatAbsoluteDateTime(value: string): string {
  return new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function getUsageTone(percent: number): string {
  if (percent >= 95) return 'bg-red-500';
  if (percent >= 80) return 'bg-amber-500';
  return 'bg-emerald-500';
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}
