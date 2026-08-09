import { Loader2, TrendingUp } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getMaasPlatformDefinition,
  MAAS_MANAGED_GATEWAY_IDS,
  type MaasManagedGatewayId,
  type MaasManagedGatewayStarSnapshot,
  type MaasManagedGatewayStarTrendPoint,
} from '@shared/maas';
import { cn } from '@renderer/utils/utils';

const CHART_WIDTH = 720;
const CHART_HEIGHT = 176;
const CHART_PADDING_X = 6;
const CHART_PADDING_Y = 10;

const SERIES_COLORS: Record<MaasManagedGatewayId, string> = {
  litellm: 'var(--foreground-diff-added)',
  cliproxyapi: 'var(--foreground-diff-modified)',
  newapi: 'var(--foreground-diff-deleted)',
};

type ManagedGatewayStarTrendProps = {
  snapshots: MaasManagedGatewayStarSnapshot[] | undefined;
  isPending: boolean;
};

type TrendSeries = {
  platformId: MaasManagedGatewayId;
  label: string;
  color: string;
  points: MaasManagedGatewayStarTrendPoint[];
  snapshot: MaasManagedGatewayStarSnapshot | undefined;
};

export function ManagedGatewayStarTrend({ snapshots, isPending }: ManagedGatewayStarTrendProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n?.language ?? 'zh-CN';
  const snapshotById = useMemo(
    () => new Map(snapshots?.map((snapshot) => [snapshot.platformId, snapshot]) ?? []),
    [snapshots]
  );
  const series = useMemo<TrendSeries[]>(
    () =>
      MAAS_MANAGED_GATEWAY_IDS.map((platformId) => {
        const snapshot = snapshotById.get(platformId);
        return {
          platformId,
          label: getMaasPlatformDefinition(platformId).name,
          color: SERIES_COLORS[platformId],
          points: snapshot?.trend?.points ?? [],
          snapshot,
        };
      }),
    [snapshotById]
  );
  const chartSeries = series.filter((item) => item.points.length > 0);
  const allPoints = chartSeries.flatMap((item) => item.points);
  const allValues = allPoints.map((point) => point.starCount);
  const firstDate = allPoints.map((point) => point.date).sort()[0];
  const lastDate = allPoints
    .map((point) => point.date)
    .sort()
    .at(-1);
  const firstTimestamp = Date.parse(`${firstDate ?? ''}T00:00:00Z`);
  const lastTimestamp = Date.parse(`${lastDate ?? ''}T00:00:00Z`);
  const rawMinimum = Math.min(...allValues);
  const rawMaximum = Math.max(...allValues);
  const rawRange = Math.max(1, rawMaximum - rawMinimum);
  const minimum = Math.max(0, rawMinimum - rawRange * 0.08);
  const maximum = rawMaximum + rawRange * 0.08;
  const hasChart =
    chartSeries.length > 0 &&
    Number.isFinite(firstTimestamp) &&
    Number.isFinite(lastTimestamp) &&
    maximum > minimum;
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }),
    [locale]
  );
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
    [locale]
  );
  const compactNumberFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        notation: 'compact',
        maximumFractionDigits: 1,
      }),
    [locale]
  );
  const formatDate = (date: string | undefined) => {
    if (!date) return '';
    return dateFormatter.format(new Date(`${date}T00:00:00Z`));
  };
  const calibrationAvailable = chartSeries.some(
    (item) => item.snapshot?.trend?.calibratedToCurrent
  );

  return (
    <section
      data-testid="maas-managed-gateway-star-trend"
      className="rounded-lg border border-border bg-background/45 p-4"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <TrendingUp className="size-4 shrink-0 text-foreground-muted" aria-hidden="true" />
          <div className="min-w-0">
            <h4 className="text-xs font-medium text-foreground">
              {t('maas.managedGateways.githubStarsTrendTitle')}
            </h4>
            <p className="mt-0.5 text-[10px] leading-relaxed text-foreground-passive">
              {t(
                calibrationAvailable
                  ? 'maas.managedGateways.githubStarsTrendDescription'
                  : 'maas.managedGateways.githubStarsTrendUncalibratedDescription'
              )}
            </p>
          </div>
        </div>
        <span className="shrink-0 text-[10px] text-foreground-passive">
          {t('maas.managedGateways.githubStarsTrendRange')}
        </span>
      </div>

      {isPending ? (
        <div className="flex h-44 items-center justify-center gap-2 text-xs text-foreground-passive">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          {t('maas.managedGateways.githubStarsTrendLoading')}
        </div>
      ) : hasChart ? (
        <div
          role="img"
          aria-label={t('maas.managedGateways.githubStarsTrendAriaLabel')}
          className="grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] gap-x-2"
        >
          <div
            aria-hidden="true"
            className="flex h-44 flex-col justify-between text-right font-mono text-[10px] tabular-nums leading-none text-foreground-passive"
          >
            <span>{compactNumberFormatter.format(maximum)}</span>
            <span>{compactNumberFormatter.format((maximum + minimum) / 2)}</span>
            <span>{compactNumberFormatter.format(minimum)}</span>
          </div>
          <div className="min-w-0">
            <svg
              aria-hidden="true"
              viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
              preserveAspectRatio="none"
              className="h-44 w-full overflow-visible rounded-sm bg-background-secondary/35"
            >
              {[0, 0.5, 1].map((ratio) => {
                const y = CHART_PADDING_Y + ratio * (CHART_HEIGHT - CHART_PADDING_Y * 2);
                return (
                  <line
                    key={ratio}
                    x1={0}
                    x2={CHART_WIDTH}
                    y1={y}
                    y2={y}
                    className={cn(ratio === 0.5 ? 'stroke-border' : 'stroke-border/70')}
                    strokeDasharray={ratio === 0.5 ? '3 4' : undefined}
                    strokeWidth={0.75}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
              {chartSeries.map((item) => {
                const coordinates = buildCoordinates(
                  item.points,
                  firstTimestamp,
                  lastTimestamp,
                  minimum,
                  maximum
                );
                const lastPoint = coordinates.at(-1);
                return (
                  <g key={item.platformId}>
                    <polyline
                      data-maas-star-trend={item.platformId}
                      points={coordinates.map((point) => `${point.x},${point.y}`).join(' ')}
                      fill="none"
                      style={{ stroke: item.color }}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                    />
                    {coordinates.map((point) => (
                      <circle
                        key={`${item.platformId}-${point.date}`}
                        cx={point.x}
                        cy={point.y}
                        r={3}
                        style={{ fill: item.color }}
                        vectorEffect="non-scaling-stroke"
                      >
                        <title>
                          {`${item.label} · ${formatDate(point.date)} · ${numberFormatter.format(point.starCount)}`}
                        </title>
                      </circle>
                    ))}
                    {lastPoint ? (
                      <circle
                        cx={lastPoint.x}
                        cy={lastPoint.y}
                        r={3.5}
                        style={{ fill: item.color, stroke: 'var(--background)' }}
                        strokeWidth={1.5}
                        vectorEffect="non-scaling-stroke"
                      />
                    ) : null}
                  </g>
                );
              })}
            </svg>
            <div className="mt-1 flex justify-between text-[10px] text-foreground-passive">
              <span>{formatDate(firstDate)}</span>
              <span>{formatDate(lastDate)}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-44 items-center justify-center text-xs text-foreground-passive">
          {t('maas.managedGateways.githubStarsTrendUnavailable')}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {series.map((item) => (
          <div key={item.platformId} className="flex items-center gap-1.5 text-xs">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-foreground-muted">{item.label}</span>
            <span className="font-mono tabular-nums text-foreground">
              {item.snapshot?.starCount == null
                ? '—'
                : numberFormatter.format(item.snapshot.starCount)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function buildCoordinates(
  points: MaasManagedGatewayStarTrendPoint[],
  firstTimestamp: number,
  lastTimestamp: number,
  minimum: number,
  maximum: number
): Array<{ date: string; starCount: number; x: number; y: number }> {
  const timeRange = Math.max(1, lastTimestamp - firstTimestamp);
  const chartWidth = CHART_WIDTH - CHART_PADDING_X * 2;
  const chartHeight = CHART_HEIGHT - CHART_PADDING_Y * 2;

  return points.flatMap((point) => {
    const timestamp = Date.parse(`${point.date}T00:00:00Z`);
    if (!Number.isFinite(timestamp)) return [];
    const timeRatio = Math.min(1, Math.max(0, (timestamp - firstTimestamp) / timeRange));
    const valueRatio = Math.min(
      1,
      Math.max(0, (point.starCount - minimum) / Math.max(1, maximum - minimum))
    );
    return [
      {
        ...point,
        x: CHART_PADDING_X + timeRatio * chartWidth,
        y: CHART_PADDING_Y + (1 - valueRatio) * chartHeight,
      },
    ];
  });
}
