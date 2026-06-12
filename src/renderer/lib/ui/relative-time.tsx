import { formatDistanceToNowStrict } from 'date-fns';
import { enUS, zhCN } from 'date-fns/locale';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type RelativeTimeProps = {
  value: string | number | Date;
  className?: string;
  /** Renders an abbreviated form (e.g. "3d", "5mo") with a tooltip showing the full text. */
  compact?: boolean;
  ago?: boolean;
};

function parseTimestamp(input: string | number | Date): Date | null {
  if (input instanceof Date) return input;
  if (typeof input === 'number') {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const raw = String(input).trim();
  if (!raw) return null;

  const normalized = raw.includes('Z') || raw.includes('+') ? raw : raw.replace(' ', 'T') + 'Z';

  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toCompactLabel(date: Date): string {
  if (Date.now() - date.getTime() < 60_000) return 'now';
  return formatDistanceToNowStrict(date, { roundingMethod: 'floor', addSuffix: false })
    .replace(/ seconds?/, 's')
    .replace(/ minutes?/, 'm')
    .replace(/ hours?/, 'h')
    .replace(/ days?/, 'd')
    .replace(/ months?/, 'mo')
    .replace(/ years?/, 'y');
}

export const RelativeTime: React.FC<RelativeTimeProps> = ({ value, className, compact, ago }) => {
  const { t, i18n } = useTranslation();
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  const date = useMemo(() => parseTimestamp(value), [value]);
  if (!date) {
    return <span className={className}>—</span>;
  }

  if (compact) {
    const short = toCompactLabel(date);
    const label =
      short === 'now' ? t('common.now') : ago ? t('common.ago', { time: short }) : short;

    return (
      <time className={className} dateTime={date.toISOString()}>
        {label}
      </time>
    );
  }

  // `addSuffix` already renders the localized "ago"/"前" — the `ago` prop only
  // matters for the compact form, whose short labels carry no suffix.
  const locale = i18n.language?.startsWith('zh') ? zhCN : enUS;
  const label = formatDistanceToNowStrict(date, { addSuffix: true, locale });
  return (
    <time className={className} dateTime={date.toISOString()}>
      {label}
    </time>
  );
};
