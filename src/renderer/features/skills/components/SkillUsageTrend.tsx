import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@renderer/utils/utils';
import { localDateKey } from '../skill-usage-stats';

const TREND_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

type TrendDay = {
  key: string;
  count: number;
};

/**
 * Per-skill invocation trend — one bar per day over the last 30 days. Pure
 * CSS like the usage TokenHeatmap (no chart library); zero days render as a
 * baseline stub so the time axis stays readable.
 */
export function SkillUsageTrend({ daily }: { daily: Record<string, number> }) {
  const { t, i18n } = useTranslation();

  const days = useMemo<TrendDay[]>(() => {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return Array.from({ length: TREND_DAYS }, (_, index) => {
      const key = localDateKey(new Date(todayStart.getTime() - (TREND_DAYS - 1 - index) * DAY_MS));
      return { key, count: daily[key] ?? 0 };
    });
  }, [daily]);

  const max = Math.max(1, ...days.map((day) => day.count));
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' }),
    [i18n.language]
  );
  const labelFor = (key: string) => dateFormatter.format(new Date(`${key}T00:00:00`));

  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2.5">
      <div className="flex h-16 items-end gap-[2px]">
        {days.map((day) => (
          <div
            key={day.key}
            title={`${labelFor(day.key)} · ${day.count}`}
            className="flex h-full min-w-0 flex-1 items-end"
          >
            <div
              className={cn(
                'w-full rounded-sm',
                day.count > 0 ? 'bg-foreground-diff-added/80' : 'bg-background-tertiary-2'
              )}
              style={{
                height: day.count > 0 ? `${Math.max(12, (day.count / max) * 100)}%` : '2px',
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{labelFor(days[0]!.key)}</span>
        <span>
          {total > 0
            ? t('skills.detail.usageTrendSummary', { count: total })
            : t('skills.detail.usageTrendEmpty')}
        </span>
        <span>{labelFor(days[days.length - 1]!.key)}</span>
      </div>
    </div>
  );
}
