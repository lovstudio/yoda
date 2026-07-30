import {
  WORKSPACE_RESOURCE_HISTORY_WINDOW_MS,
  type WorkspaceResourceHistoryPoint,
} from './workspace-resource-history';

const CHART_WIDTH = 640;
const CHART_HEIGHT = 132;
const CHART_PADDING_X = 4;
const CHART_PADDING_Y = 8;

export type WorkspaceResourceDetailSeries = {
  key: string;
  label: string;
  value: string;
  color: string;
  valueForPoint: (point: WorkspaceResourceHistoryPoint) => number | null | undefined;
};

type Props = {
  history: WorkspaceResourceHistoryPoint[];
  ariaLabel: string;
  emptyLabel: string;
  startLabel: string;
  endLabel: string;
  series: WorkspaceResourceDetailSeries[];
  minimumCeiling?: number;
};

export function WorkspaceResourceDetailChart({
  history,
  ariaLabel,
  emptyLabel,
  startLabel,
  endLabel,
  series,
  minimumCeiling = 1,
}: Props) {
  const values = series.flatMap((item) =>
    history.flatMap((point) => {
      const value = item.valueForPoint(point);
      return value == null || !Number.isFinite(value) ? [] : [value];
    })
  );
  const ceiling = Math.max(minimumCeiling, ...values) * 1.12;
  const seriesCoordinates = series.map((item) => ({
    ...item,
    coordinates: buildCoordinates(history, item.valueForPoint, ceiling),
  }));
  const hasData = seriesCoordinates.some((item) => item.coordinates.length > 0);

  return (
    <section
      role="img"
      aria-label={ariaLabel}
      className="rounded-lg border border-border bg-background p-4"
    >
      {hasData ? (
        <>
          <svg
            aria-hidden
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            preserveAspectRatio="none"
            className="h-32 w-full overflow-visible"
          >
            {[0.25, 0.5, 0.75].map((ratio) => (
              <line
                key={ratio}
                x1={0}
                x2={CHART_WIDTH}
                y1={CHART_HEIGHT * ratio}
                y2={CHART_HEIGHT * ratio}
                className="stroke-border"
                strokeDasharray="3 4"
                strokeWidth={0.75}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {seriesCoordinates.map((item) => {
              const lastPoint = item.coordinates.at(-1);
              return (
                <g key={item.key}>
                  <polyline
                    data-resource-detail-trend={item.key}
                    points={item.coordinates.map((point) => `${point.x},${point.y}`).join(' ')}
                    fill="none"
                    style={{ stroke: item.color }}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                  {lastPoint ? (
                    <circle
                      cx={lastPoint.x}
                      cy={lastPoint.y}
                      r={3}
                      style={{ fill: item.color }}
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}
                </g>
              );
            })}
          </svg>
          <div className="mt-1 flex justify-between text-[10px] text-foreground-passive">
            <span>{startLabel}</span>
            <span>{endLabel}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            {seriesCoordinates.map((item) => (
              <div key={item.key} className="flex items-center gap-2 text-xs">
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-foreground-muted">{item.label}</span>
                <span className="font-mono tabular-nums text-foreground">{item.value}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="flex h-32 items-center justify-center text-xs text-foreground-passive">
          {emptyLabel}
        </div>
      )}
    </section>
  );
}

function buildCoordinates(
  history: WorkspaceResourceHistoryPoint[],
  valueForPoint: (point: WorkspaceResourceHistoryPoint) => number | null | undefined,
  ceiling: number
): Array<{ x: number; y: number }> {
  const newestAt = Date.parse(history.at(-1)?.sampledAt ?? '');
  if (!Number.isFinite(newestAt)) return [];

  const chartWidth = CHART_WIDTH - CHART_PADDING_X * 2;
  const chartHeight = CHART_HEIGHT - CHART_PADDING_Y * 2;
  const windowStart = newestAt - WORKSPACE_RESOURCE_HISTORY_WINDOW_MS;

  return history.flatMap((point) => {
    const sampledAt = Date.parse(point.sampledAt);
    const value = valueForPoint(point);
    if (!Number.isFinite(sampledAt) || value == null || !Number.isFinite(value)) return [];
    const timeRatio = Math.min(
      1,
      Math.max(0, (sampledAt - windowStart) / WORKSPACE_RESOURCE_HISTORY_WINDOW_MS)
    );
    const valueRatio = Math.min(1, Math.max(0, value / ceiling));
    return [
      {
        x: CHART_PADDING_X + timeRatio * chartWidth,
        y: CHART_PADDING_Y + (1 - valueRatio) * chartHeight,
      },
    ];
  });
}
