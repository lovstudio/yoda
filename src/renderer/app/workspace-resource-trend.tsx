import {
  WORKSPACE_RESOURCE_HISTORY_WINDOW_MS,
  type WorkspaceResourceHistoryPoint,
} from './workspace-resource-history';

const CHART_WIDTH = 280;
const CHART_HEIGHT = 30;
const CHART_PADDING = 2;

type WorkspaceResourceTrendProps = {
  history: WorkspaceResourceHistoryPoint[];
  title: string;
  refreshLabel: string;
  cpuLabel: string;
  cpuValue: string;
  cpuAriaLabel: string;
  memoryLabel: string;
  memoryValue: string;
  memoryAriaLabel: string;
};

type TrendRowProps = {
  history: WorkspaceResourceHistoryPoint[];
  label: string;
  value: string;
  ariaLabel: string;
  valueForPoint: (point: WorkspaceResourceHistoryPoint) => number;
  ceiling: number;
  lineClassName: string;
  dotClassName: string;
  legendClassName: string;
};

export function WorkspaceResourceTrend({
  history,
  title,
  refreshLabel,
  cpuLabel,
  cpuValue,
  cpuAriaLabel,
  memoryLabel,
  memoryValue,
  memoryAriaLabel,
}: WorkspaceResourceTrendProps) {
  const cpuCeiling = Math.max(100, ...history.map((point) => point.cpuPercent));
  const memoryCeiling = Math.max(1, ...history.map((point) => point.memoryBytes)) * 1.12;

  return (
    <section className="border-b border-border px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[11px] font-medium text-foreground-muted">{title}</span>
        <span className="text-[10px] text-foreground-passive">{refreshLabel}</span>
      </div>
      <div className="space-y-1.5">
        <TrendRow
          history={history}
          label={cpuLabel}
          value={cpuValue}
          ariaLabel={cpuAriaLabel}
          valueForPoint={(point) => point.cpuPercent}
          ceiling={cpuCeiling}
          lineClassName="stroke-accent"
          dotClassName="fill-accent"
          legendClassName="bg-accent"
        />
        <TrendRow
          history={history}
          label={memoryLabel}
          value={memoryValue}
          ariaLabel={memoryAriaLabel}
          valueForPoint={(point) => point.memoryBytes}
          ceiling={memoryCeiling}
          lineClassName="stroke-foreground-diff-added"
          dotClassName="fill-foreground-diff-added"
          legendClassName="bg-foreground-diff-added"
        />
      </div>
    </section>
  );
}

function TrendRow({
  history,
  label,
  value,
  ariaLabel,
  valueForPoint,
  ceiling,
  lineClassName,
  dotClassName,
  legendClassName,
}: TrendRowProps) {
  const coordinates = buildTrendCoordinates(history, valueForPoint, ceiling);
  const lastPoint = coordinates.at(-1);

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className="grid grid-cols-[3rem_minmax(0,1fr)_4.75rem] items-center gap-2"
    >
      <span className="flex items-center gap-1.5 text-[10px] text-foreground-passive">
        <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${legendClassName}`} />
        {label}
      </span>
      <svg
        aria-hidden
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
        className="h-[30px] w-full overflow-visible rounded-sm bg-background-secondary/60"
      >
        <line
          x1={0}
          x2={CHART_WIDTH}
          y1={CHART_HEIGHT / 2}
          y2={CHART_HEIGHT / 2}
          className="stroke-border"
          strokeWidth={0.75}
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          data-resource-trend={label}
          points={coordinates.map((point) => `${point.x},${point.y}`).join(' ')}
          className={lineClassName}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        {lastPoint ? (
          <circle
            cx={lastPoint.x}
            cy={lastPoint.y}
            r={1.8}
            className={dotClassName}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
      <span className="text-right font-mono text-[10px] tabular-nums text-foreground-muted">
        {value}
      </span>
    </div>
  );
}

function buildTrendCoordinates(
  history: WorkspaceResourceHistoryPoint[],
  valueForPoint: (point: WorkspaceResourceHistoryPoint) => number,
  ceiling: number
): Array<{ x: number; y: number }> {
  const newestAt = Date.parse(history.at(-1)?.sampledAt ?? '');
  if (!Number.isFinite(newestAt)) return [];

  const chartRange = CHART_WIDTH - CHART_PADDING * 2;
  const chartHeight = CHART_HEIGHT - CHART_PADDING * 2;
  const windowStart = newestAt - WORKSPACE_RESOURCE_HISTORY_WINDOW_MS;

  return history.flatMap((point) => {
    const sampledAt = Date.parse(point.sampledAt);
    if (!Number.isFinite(sampledAt)) return [];
    const timeRatio = Math.min(
      1,
      Math.max(0, (sampledAt - windowStart) / WORKSPACE_RESOURCE_HISTORY_WINDOW_MS)
    );
    const valueRatio = Math.min(1, Math.max(0, valueForPoint(point) / ceiling));
    return [
      {
        x: CHART_PADDING + timeRatio * chartRange,
        y: CHART_PADDING + (1 - valueRatio) * chartHeight,
      },
    ];
  });
}
