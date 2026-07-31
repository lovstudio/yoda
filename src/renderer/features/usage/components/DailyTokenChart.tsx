import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DailyTokenUsage } from '@shared/stats';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { formatCompactNumber } from '@renderer/utils/format-compact-number';
import { cn } from '@renderer/utils/utils';

const CHART_RANGES = [7, 30, 90] as const;

export type DailyTokenChartRange = (typeof CHART_RANGES)[number];

export type DailyTokenChartDay = {
  key: string;
  total: number;
};

/**
 * A full-width daily bar chart. The selected range changes the density while
 * every bar keeps representing exactly one local calendar day.
 */
export function DailyTokenChart({ daily }: { daily: DailyTokenUsage[] }) {
  const { t, i18n } = useTranslation();
  const [range, setRange] = useState<DailyTokenChartRange>(30);

  const days = useMemo(() => buildDailyTokenChartDays(daily, new Date(), range), [daily, range]);
  const total = days.reduce((sum, day) => sum + day.total, 0);
  const peak = days.reduce<DailyTokenChartDay>(
    (highest, day) => (day.total > highest.total ? day : highest),
    days[0]!
  );
  const ceiling = niceChartCeiling(peak.total);
  const midpoint = ceiling / 2;
  const average = total / range;
  const middleDay = days[Math.floor(days.length / 2)]!;

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' }),
    [i18n.language]
  );
  const exactNumberFormatter = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const labelFor = (key: string) => dateFormatter.format(dateFromLocalDateKey(key));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <dl className="flex min-w-0 flex-wrap items-baseline gap-x-6 gap-y-1">
          <ChartMetric
            label={t('usage.dailyChart.periodTotal')}
            value={formatCompactNumber(total)}
          />
          <ChartMetric
            label={t('usage.dailyChart.dailyAverage')}
            value={formatCompactNumber(average)}
          />
          <ChartMetric
            label={t('usage.dailyChart.peak')}
            value={formatCompactNumber(peak.total)}
            detail={peak.total > 0 ? labelFor(peak.key) : undefined}
          />
        </dl>

        <ToggleGroup
          size="xs"
          multiple={false}
          value={[String(range)]}
          onValueChange={([value]) => {
            const nextRange = Number(value);
            if (isDailyTokenChartRange(nextRange)) setRange(nextRange);
          }}
          aria-label={t('usage.dailyChart.rangeLabel')}
          className="shrink-0"
        >
          {CHART_RANGES.map((daysInRange) => (
            <ToggleGroupItem key={daysInRange} value={String(daysInRange)} className="px-2.5">
              {t(`usage.dailyChart.ranges.${daysInRange}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div
        role="img"
        aria-label={t('usage.dailyChart.ariaLabel', {
          range,
          total: exactNumberFormatter.format(total),
          average: exactNumberFormatter.format(Math.round(average)),
          peak: exactNumberFormatter.format(peak.total),
        })}
        className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1.5"
      >
        <div
          aria-hidden
          className="flex h-44 flex-col justify-between text-right font-mono text-[10px] tabular-nums leading-none text-foreground-passive"
        >
          <span>{formatCompactNumber(ceiling)}</span>
          <span>{formatCompactNumber(midpoint)}</span>
          <span>0</span>
        </div>

        <div className="relative h-44 min-w-0 border-b border-border/70">
          <span aria-hidden className="absolute inset-x-0 top-0 border-t border-border/55" />
          <span
            aria-hidden
            className="absolute inset-x-0 top-1/2 border-t border-dashed border-border/55"
          />
          <div
            aria-hidden
            className={cn(
              'absolute inset-0 flex items-end',
              range === 7 ? 'gap-2' : range === 30 ? 'gap-[3px]' : 'gap-px'
            )}
          >
            {days.map((day) => {
              const height = day.total > 0 ? Math.max(3, (day.total / ceiling) * 100) : 0;
              const isPeak = day.total > 0 && day.total === peak.total;
              return (
                <span
                  key={day.key}
                  className="group flex h-full min-w-0 flex-1 items-end justify-center"
                  title={
                    day.total > 0
                      ? t('usage.dailyChart.dayTooltip', {
                          date: labelFor(day.key),
                          tokens: exactNumberFormatter.format(day.total),
                        })
                      : t('usage.dailyChart.emptyDayTooltip', { date: labelFor(day.key) })
                  }
                >
                  <span
                    className={cn(
                      'w-full rounded-t-[2px] transition-colors group-hover:bg-foreground-diff-added',
                      range === 7 ? 'max-w-12' : range === 30 ? 'max-w-7' : 'max-w-4',
                      day.total > 0
                        ? isPeak
                          ? 'bg-foreground-diff-added'
                          : 'bg-foreground-diff-added/65'
                        : 'h-px bg-background-tertiary-2'
                    )}
                    style={day.total > 0 ? { height: `${height}%` } : undefined}
                  />
                </span>
              );
            })}
          </div>
        </div>

        <span aria-hidden />
        <div
          aria-hidden
          className="flex min-w-0 items-center justify-between text-[10px] leading-none text-foreground-passive"
        >
          <span>{labelFor(days[0]!.key)}</span>
          <span>{labelFor(middleDay.key)}</span>
          <span>{labelFor(days.at(-1)!.key)}</span>
        </div>
      </div>
    </div>
  );
}

function ChartMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <dt className="text-[10px] text-foreground-passive">{label}</dt>
      <dd className="font-mono text-xs font-medium tabular-nums text-foreground-muted">
        {value}
        {detail && (
          <span className="ml-1 font-sans font-normal text-foreground-passive">{detail}</span>
        )}
      </dd>
    </div>
  );
}

export function buildDailyTokenChartDays(
  daily: DailyTokenUsage[],
  today: Date,
  range: DailyTokenChartRange
): DailyTokenChartDay[] {
  const totalsByDate = new Map(daily.map((day) => [day.date, day.tokens.total]));
  const todayStart = startOfLocalDay(today);

  return Array.from({ length: range }, (_, index) => {
    const date = new Date(todayStart);
    date.setDate(date.getDate() - (range - 1 - index));
    const key = localDateKey(date);
    return { key, total: totalsByDate.get(key) ?? 0 };
  });
}

export function niceChartCeiling(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceNormalized * magnitude;
}

function isDailyTokenChartRange(value: number): value is DailyTokenChartRange {
  return CHART_RANGES.some((range) => range === value);
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromLocalDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year!, month! - 1, day!);
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
