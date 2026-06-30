import {
  Activity,
  Clock,
  Database,
  ExternalLink,
  FileText,
  Image,
  Key,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  RefreshCw,
  Zap,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MAAS_INVOCATION_KINDS,
  MAAS_PLATFORMS,
  type MaasConnection,
  type MaasInvocationFilterKind,
  type MaasInvocationKind,
  type MaasInvocationRecord,
} from '@shared/maas';
import { rpc } from '@renderer/lib/ipc';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { cn } from '@renderer/utils/utils';
import { useMaasConnections, useMaasInvocationRecords } from '../useMaas';

const FILTERS: MaasInvocationFilterKind[] = ['all', ...MAAS_INVOCATION_KINDS];
const ZENMUX_LOGS_URL = 'https://zenmux.ai/platform/logs';

const KIND_META: Record<
  MaasInvocationKind,
  {
    icon: React.ComponentType<{ className?: string }>;
    badgeClassName: string;
    previewClassName: string;
  }
> = {
  text: {
    icon: MessageSquare,
    badgeClassName: 'border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    previewClassName: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  },
  image: {
    icon: Image,
    badgeClassName:
      'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    previewClassName: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  embedding: {
    icon: Database,
    badgeClassName: 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    previewClassName: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  video: {
    icon: Activity,
    badgeClassName: 'border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    previewClassName: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  },
};

const STATUS_CLASS_NAME = {
  succeeded: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  failed: 'border-destructive/20 bg-destructive/10 text-destructive',
  streaming: 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300',
} satisfies Record<MaasInvocationRecord['status'], string>;

type Props = BaseModalProps<void>;

function findZenmuxConnection(connections: MaasConnection[] | undefined): MaasConnection {
  return (
    connections?.find((connection) => connection.platformId === 'zenmux') ?? {
      platformId: 'zenmux',
      displayName: MAAS_PLATFORMS.zenmux.name,
      endpoint: MAAS_PLATFORMS.zenmux.defaultEndpoint,
      keyFingerprint: null,
      connectedAt: null,
      lastCheckedAt: null,
      connected: false,
      error: null,
    }
  );
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatTokens(value: number | null): string {
  if (typeof value !== 'number') return '-';
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function formatMs(value: number | null): string {
  if (typeof value !== 'number') return '-';
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${value}ms`;
}

function formatCost(value: number | null): string {
  if (typeof value !== 'number') return '-';
  return `$${value.toFixed(4)}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatDateRange(period: { startingAt: string; endingAt: string } | null): string {
  if (!period) return '';
  return `${formatDate(period.startingAt)} - ${formatDate(period.endingAt)}`;
}

export function ZenmuxUsageModal(_props: Props) {
  const { data: connections } = useMaasConnections();
  const connection = findZenmuxConnection(connections);
  const usageSection = useZenmuxUsageSection({
    connection,
    embedded: false,
    enabled: connection.connected,
  });

  return (
    <>
      <DialogHeader className="min-w-0 flex-1 items-center gap-4">
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-lg font-semibold tracking-normal text-foreground normal-case">
            {usageSection.title}
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm leading-relaxed">
            {usageSection.description}
          </DialogDescription>
        </div>
        <div className="flex shrink-0 items-center">{usageSection.action}</div>
      </DialogHeader>
      <DialogContentArea className="gap-0 overflow-hidden px-6 pb-6 pt-0">
        {usageSection.component}
      </DialogContentArea>
    </>
  );
}

function useZenmuxUsageSection({
  connection,
  embedded,
  enabled,
}: {
  connection: MaasConnection;
  embedded: boolean;
  enabled: boolean;
}): {
  title: string;
  description: React.ReactNode;
  action: React.ReactNode;
  component: React.ReactNode;
} {
  const { t } = useTranslation();
  const [filterKind, setFilterKind] = useState<MaasInvocationFilterKind>('all');
  const recordsQuery = useMaasInvocationRecords('zenmux', filterKind, enabled);
  const recordsSubtitle = !connection.connected
    ? t('maas.records.emptyNoConnection')
    : recordsQuery.error
      ? t('maas.records.errorTitle')
      : recordsQuery.loading && recordsQuery.records.length === 0
        ? t('maas.records.loading')
        : t('maas.records.subtitle', {
            count: formatCount(recordsQuery.records.length),
            total: formatCount(recordsQuery.total),
            range: formatDateRange(recordsQuery.period),
          });

  return {
    title: t('maas.records.title'),
    description: recordsSubtitle,
    action: (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-xs" aria-label={t('common.more')}>
              <MoreHorizontal className="size-3.5" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={() => void rpc.app.openExternal(ZENMUX_LOGS_URL)}>
            <ExternalLink className="size-3.5" />
            {t('maas.records.openZenmuxLogs')}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!connection.connected || recordsQuery.reloading}
            onClick={recordsQuery.reload}
          >
            <RefreshCw className={cn('size-3.5', recordsQuery.reloading && 'animate-spin')} />
            {t('maas.records.reload')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    component: (
      <ZenmuxUsageRecords
        connection={connection}
        embedded={embedded}
        filterKind={filterKind}
        recordsQuery={recordsQuery}
        onFilterKindChange={setFilterKind}
      />
    ),
  };
}

const ZenmuxUsageRecords: React.FC<{
  connection: MaasConnection;
  embedded: boolean;
  filterKind: MaasInvocationFilterKind;
  recordsQuery: ReturnType<typeof useMaasInvocationRecords>;
  onFilterKindChange: (kind: MaasInvocationFilterKind) => void;
}> = ({ connection, embedded, filterKind, recordsQuery, onFilterKindChange }) => {
  const { t } = useTranslation();

  return (
    <div className="@container flex min-h-0 min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="text-xs font-medium text-foreground-muted">
          {t('maas.records.filterLabel')}
        </span>
        <ToggleGroup
          multiple={false}
          value={[filterKind]}
          aria-label={t('maas.records.filterLabel')}
          className="h-auto max-w-full flex-wrap justify-end overflow-hidden rounded-lg border border-border/70 bg-background-1 p-0.5"
          onValueChange={([value]) => {
            if (value) onFilterKindChange(value as MaasInvocationFilterKind);
          }}
        >
          {FILTERS.map((kind) => (
            <ToggleGroupItem key={kind} value={kind} className="h-7 gap-1.5 px-2.5 text-xs">
              {kind === 'all' ? (
                <Activity className="h-3.5 w-3.5" />
              ) : (
                React.createElement(KIND_META[kind].icon, { className: 'h-3.5 w-3.5' })
              )}
              <span>{t(`maas.records.filters.${kind}`)}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div
        className={cn(
          '@container flex min-h-0 flex-col overflow-hidden rounded-lg border border-border/70 bg-background',
          embedded ? 'h-[360px]' : 'h-[62vh] min-h-[22rem] max-h-[34rem]'
        )}
      >
        <RecordFeed
          connected={connection.connected}
          filterKind={filterKind}
          records={recordsQuery.records}
          loading={recordsQuery.loading}
          error={recordsQuery.error}
          hasNextPage={!!recordsQuery.hasNextPage}
          isFetchingNextPage={recordsQuery.isFetchingNextPage}
          fetchNextPage={() => void recordsQuery.fetchNextPage()}
        />
      </div>
    </div>
  );
};

const RecordFeed: React.FC<{
  connected: boolean;
  filterKind: MaasInvocationFilterKind;
  records: MaasInvocationRecord[];
  loading: boolean;
  error: string | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}> = ({
  connected,
  filterKind,
  records,
  loading,
  error,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}) => {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasImagePreviews = records.some((record) => record.previewUrl);

  const maybeLoadMore = useCallback(() => {
    const element = scrollRef.current;
    if (!element || !hasNextPage || isFetchingNextPage) return;
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distanceToBottom < 280) fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  useEffect(() => {
    maybeLoadMore();
  }, [maybeLoadMore, records.length]);

  if (!connected) {
    return (
      <EmptyState
        label={t('maas.records.emptyNoConnectionTitle')}
        description={t('maas.records.emptyNoConnection')}
      />
    );
  }

  if (loading && records.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return <EmptyState label={t('maas.records.errorTitle')} description={error} />;
  }

  if (records.length === 0) {
    return <EmptyState label={t('maas.records.emptyNoRecords')} />;
  }

  return (
    <div ref={scrollRef} onScroll={maybeLoadMore} className="min-h-0 flex-1 overflow-y-auto">
      {filterKind === 'image' && hasImagePreviews ? (
        <div className="grid grid-cols-1 gap-3 p-4 @2xl:grid-cols-2 @5xl:grid-cols-3">
          {records.map((record) => (
            <ImageRecordCard key={record.id} record={record} />
          ))}
        </div>
      ) : (
        <div className="divide-y divide-border/60">
          {records.map((record) => (
            <InvocationRecordRow key={record.id} record={record} showKind={filterKind === 'all'} />
          ))}
        </div>
      )}
      <div className="flex h-12 items-center justify-center text-xs text-muted-foreground">
        {isFetchingNextPage ? (
          <>
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            {t('common.loadingMore')}
          </>
        ) : hasNextPage ? (
          t('maas.records.scrollHint')
        ) : (
          t('maas.records.end')
        )}
      </div>
    </div>
  );
};

const InvocationRecordRow: React.FC<{ record: MaasInvocationRecord; showKind: boolean }> = ({
  record,
  showKind,
}) => {
  const { t } = useTranslation();
  const meta = KIND_META[record.kind];
  const Icon = meta.icon;

  return (
    <article className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-4 px-4 py-3 transition-colors hover:bg-background-1/60">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
            meta.previewClassName
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="min-w-0 truncate text-sm font-medium">{record.title}</h3>
            {showKind && (
              <Badge variant="outline" className={cn('shrink-0', meta.badgeClassName)}>
                {t(`maas.records.filters.${record.kind}`)}
              </Badge>
            )}
            <Badge variant="outline" className={cn('shrink-0', STATUS_CLASS_NAME[record.status])}>
              {t(`maas.records.status.${record.status}`)}
            </Badge>
          </div>
          {record.prompt && (
            <p className="mt-1 truncate text-xs text-muted-foreground">{record.prompt}</p>
          )}
          {record.outputSummary && (
            <p className="mt-1 truncate text-xs text-foreground-muted">{record.outputSummary}</p>
          )}
          <RecordMetrics record={record} />
        </div>
      </div>
      <div className="pt-1 text-right">
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDateTime(record.createdAt)}
        </span>
      </div>
    </article>
  );
};

const ImageRecordCard: React.FC<{ record: MaasInvocationRecord }> = ({ record }) => {
  const { t } = useTranslation();

  return (
    <article className="overflow-hidden rounded-md border border-border bg-background">
      <div className="relative flex aspect-[4/3] items-center justify-center bg-background-tertiary">
        {record.previewUrl ? (
          <img
            src={record.previewUrl}
            alt={record.prompt || record.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <>
            <div className="absolute inset-3 rounded-md border border-emerald-500/20 bg-emerald-500/10" />
            <Image className="relative h-10 w-10 text-emerald-700/80 dark:text-emerald-300/80" />
          </>
        )}
        <Badge
          variant="outline"
          className={cn('absolute left-3 top-3', STATUS_CLASS_NAME[record.status])}
        >
          {t(`maas.records.status.${record.status}`)}
        </Badge>
        {record.dimensions && (
          <Badge variant="secondary" className="absolute bottom-3 right-3 font-mono">
            {record.dimensions}
          </Badge>
        )}
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium">{record.model}</h3>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {record.prompt}
            </p>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatDateTime(record.createdAt)}
          </span>
        </div>
        <RecordMetrics record={record} compact />
      </div>
    </article>
  );
};

const RecordMetrics: React.FC<{ record: MaasInvocationRecord; compact?: boolean }> = ({
  record,
  compact = false,
}) => {
  const { t } = useTranslation();
  const items = useMemo(
    () =>
      [
        {
          icon: FileText,
          label: t('maas.records.input'),
          rawValue: record.inputTokens,
          format: formatTokens,
        },
        {
          icon: Zap,
          label: t('maas.records.output'),
          rawValue: record.outputTokens,
          format: formatTokens,
        },
        {
          icon: Clock,
          label: t('maas.records.latency'),
          rawValue: record.latencyMs,
          format: formatMs,
        },
        {
          icon: Activity,
          label: t('maas.records.duration'),
          rawValue: record.durationMs,
          format: formatMs,
        },
        {
          icon: Key,
          label: t('maas.records.cost'),
          rawValue: record.costUsd,
          format: formatCost,
        },
      ].filter((item) => item.rawValue !== null),
    [
      record.costUsd,
      record.durationMs,
      record.inputTokens,
      record.latencyMs,
      record.outputTokens,
      t,
    ]
  );

  return (
    <div className={cn('mt-3 flex flex-wrap gap-1.5', compact && 'mt-2')}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <span
            key={item.label}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-border/70 bg-background-secondary px-2 text-[11px] text-muted-foreground"
          >
            <Icon className="h-3 w-3" />
            <span>{item.label}</span>
            <span className="font-mono text-foreground-muted">{item.format(item.rawValue)}</span>
          </span>
        );
      })}
      {record.assetCount && (
        <span className="inline-flex h-6 items-center rounded-md border border-border/70 bg-background-secondary px-2 text-[11px] text-muted-foreground">
          {t('maas.records.assets', { count: record.assetCount })}
        </span>
      )}
    </div>
  );
};
