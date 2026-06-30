import * as AccordionPrimitive from '@radix-ui/react-accordion';
import {
  Activity,
  ChevronDown,
  Clock,
  Database,
  ExternalLink,
  FileText,
  Image,
  Key,
  Layers,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Plug,
  RefreshCw,
  Unplug,
  Zap,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MAAS_INVOCATION_KINDS,
  MAAS_PLATFORM_IDS,
  MAAS_PLATFORMS,
  type MaasConnection,
  type MaasInvocationFilterKind,
  type MaasInvocationKind,
  type MaasInvocationRecord,
  type MaasPlatformId,
} from '@shared/maas';
import { rpc } from '@renderer/lib/ipc';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { Input } from '@renderer/lib/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { cn } from '@renderer/utils/utils';
import {
  useConnectMaasPlatform,
  useDisconnectMaasPlatform,
  useMaasConnections,
  useMaasInvocationRecords,
} from '../useMaas';

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

function findConnection(
  connections: MaasConnection[] | undefined,
  platformId: MaasPlatformId
): MaasConnection {
  return (
    connections?.find((connection) => connection.platformId === platformId) ?? {
      platformId,
      displayName: MAAS_PLATFORMS[platformId].name,
      endpoint: MAAS_PLATFORMS[platformId].defaultEndpoint,
      keyFingerprint: null,
      connectedAt: null,
      lastCheckedAt: null,
      connected: false,
      error: null,
    }
  );
}

function isMaasPlatformId(value: string): value is MaasPlatformId {
  return (MAAS_PLATFORM_IDS as readonly string[]).includes(value);
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

export const MaasView: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { t } = useTranslation();
  const { data: connections, isLoading } = useMaasConnections();
  const [selectedPlatformId, setSelectedPlatformId] = useState<MaasPlatformId>('zenmux');
  const [expandedPlatformId, setExpandedPlatformId] = useState<MaasPlatformId | ''>('zenmux');
  const [filterKind, setFilterKind] = useState<MaasInvocationFilterKind>('all');
  const selectedConnection = findConnection(connections, selectedPlatformId);
  const connectedCount = connections?.filter((connection) => connection.connected).length ?? 0;

  const recordsQuery = useMaasInvocationRecords(
    selectedPlatformId,
    filterKind,
    selectedConnection.connected
  );
  const recordsSubtitle = !selectedConnection.connected
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

  const handlePlatformValueChange = useCallback((value: string) => {
    if (value === '') {
      setExpandedPlatformId('');
      return;
    }
    if (!isMaasPlatformId(value)) return;
    setExpandedPlatformId(value);
    setSelectedPlatformId(value);
  }, []);

  const recordsToolbarActions = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-xs" aria-label={t('common.more')}>
            <MoreHorizontal className="size-3.5" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-40">
        {selectedPlatformId === 'zenmux' && (
          <DropdownMenuItem onClick={() => void rpc.app.openExternal(ZENMUX_LOGS_URL)}>
            <ExternalLink className="size-3.5" />
            {t('maas.records.openZenmuxLogs')}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          disabled={!selectedConnection.connected || recordsQuery.reloading}
          onClick={recordsQuery.reload}
        >
          <RefreshCw className={cn('size-3.5', recordsQuery.reloading && 'animate-spin')} />
          {t('maas.records.reload')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const recordsFilters = (
    <div className="flex max-w-full justify-end">
      <ToggleGroup
        multiple={false}
        value={[filterKind]}
        className="h-auto max-w-full flex-wrap justify-start overflow-hidden"
        onValueChange={([value]) => {
          if (value) setFilterKind(value as MaasInvocationFilterKind);
        }}
      >
        {FILTERS.map((kind) => (
          <ToggleGroupItem key={kind} value={kind} className="gap-1.5">
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
  );

  const content = (
    <div
      className={cn(
        'flex min-h-0 flex-col gap-8',
        embedded ? 'w-full' : 'mx-auto w-full max-w-5xl px-6 py-6'
      )}
    >
      <MaasChapter
        title={t('maas.platformsTitle')}
        action={
          <Badge variant="secondary">{t('maas.connectedCount', { count: connectedCount })}</Badge>
        }
      >
        <AccordionPrimitive.Root
          type="single"
          collapsible
          value={expandedPlatformId}
          onValueChange={handlePlatformValueChange}
          className="overflow-hidden rounded-xl border border-border/60 bg-muted/10"
        >
          {MAAS_PLATFORM_IDS.map((platformId) => (
            <PlatformAccordionItem
              key={platformId}
              connection={findConnection(connections, platformId)}
              loading={isLoading}
            />
          ))}
        </AccordionPrimitive.Root>
      </MaasChapter>

      <MaasChapter
        title={t('maas.records.title')}
        description={recordsSubtitle}
        action={recordsToolbarActions}
      >
        {recordsFilters}
        <div
          className={cn(
            '@container flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-muted/10',
            embedded ? 'h-[420px]' : 'h-[560px]'
          )}
        >
          <RecordFeed
            connected={selectedConnection.connected}
            filterKind={filterKind}
            records={recordsQuery.records}
            loading={recordsQuery.loading}
            error={recordsQuery.error}
            hasNextPage={!!recordsQuery.hasNextPage}
            isFetchingNextPage={recordsQuery.isFetchingNextPage}
            fetchNextPage={() => void recordsQuery.fetchNextPage()}
          />
        </div>
      </MaasChapter>
    </div>
  );

  return (
    <div
      className={cn(
        // Container queries — this view also lives embedded in the narrow
        // settings side pane where viewport breakpoints lie.
        '@container flex min-h-0 bg-background text-foreground',
        embedded ? 'flex-col' : 'h-full flex-col overflow-y-auto'
      )}
    >
      {!embedded && (
        <div className="border-b border-border px-4 py-4">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-foreground-muted" />
            <h1 className="text-sm font-semibold">{t('maas.title')}</h1>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('maas.subtitle')}</p>
        </div>
      )}
      {content}
    </div>
  );
};

const MaasChapter: React.FC<{
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, description, action, children }) => {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-normal text-foreground">{title}</h3>
          {description && <p className="mt-1 text-xs text-foreground-muted">{description}</p>}
        </div>
        {action && <div className="flex min-w-0 max-w-full justify-end">{action}</div>}
      </div>
      {children}
    </section>
  );
};

const PlatformAccordionItem: React.FC<{
  connection: MaasConnection;
  loading: boolean;
}> = ({ connection, loading }) => {
  const { t } = useTranslation();
  const platform = MAAS_PLATFORMS[connection.platformId];

  return (
    <AccordionPrimitive.Item
      value={connection.platformId}
      className="border-b border-border/50 transition-colors last:border-b-0 data-[state=open]:bg-background-1/40"
    >
      <AccordionPrimitive.Header className="flex items-center gap-1 pr-2.5">
        <AccordionPrimitive.Trigger className="group flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/30 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border">
          <ChevronDown
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-200 group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-background-secondary">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm text-foreground">{platform.name}</span>
            <span className="truncate font-mono text-[10px] text-muted-foreground">
              {connection.endpoint}
            </span>
          </span>
          <span className="hidden min-w-0 max-w-64 truncate text-xs text-muted-foreground @4xl:block">
            {t(`maas.platforms.${connection.platformId}.description`)}
          </span>
          <Badge variant={connection.connected ? 'outline' : 'secondary'} className="shrink-0">
            {connection.connected ? t('maas.connected') : t('maas.notConnected')}
          </Badge>
          <span
            className={cn(
              'h-1.5 w-1.5 shrink-0 rounded-full',
              connection.connected ? 'bg-emerald-500' : 'bg-muted-foreground/40',
              loading && 'animate-pulse'
            )}
          />
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>
      <AccordionPrimitive.Content
        className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
        style={
          {
            '--accordion-panel-height': 'var(--radix-accordion-content-height)',
          } as React.CSSProperties
        }
      >
        <ConnectionPanel
          key={`${connection.platformId}:${connection.keyFingerprint ?? 'empty'}`}
          connection={connection}
          className="border-t border-border/50"
        />
      </AccordionPrimitive.Content>
    </AccordionPrimitive.Item>
  );
};

const ConnectionPanel: React.FC<{ connection: MaasConnection; className?: string }> = ({
  connection,
  className,
}) => {
  const { t } = useTranslation();
  const platform = MAAS_PLATFORMS[connection.platformId];
  const connectMutation = useConnectMaasPlatform();
  const disconnectMutation = useDisconnectMaasPlatform();
  const [apiKey, setApiKey] = useState('');
  const [displayName, setDisplayName] = useState(connection.displayName);
  const [endpoint, setEndpoint] = useState(connection.endpoint);
  const [formError, setFormError] = useState<string | null>(null);

  const saving = connectMutation.isPending;
  const disconnecting = disconnectMutation.isPending;
  const hasStoredKey = connection.connected && !!connection.keyFingerprint;
  const apiKeyLabel =
    connection.platformId === 'zenmux'
      ? t('maas.connection.managementApiKey')
      : t('maas.connection.apiKey');
  const apiKeyPlaceholder =
    connection.platformId === 'zenmux'
      ? t('maas.connection.zenmuxManagementKeyPlaceholder')
      : t('maas.connection.apiKeyPlaceholder');

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!apiKey.trim() && !hasStoredKey) {
      setFormError(t('maas.connection.apiKeyRequired'));
      return;
    }

    setFormError(null);
    connectMutation.mutate(
      {
        platformId: connection.platformId,
        apiKey: apiKey.trim() || undefined,
        displayName,
        endpoint,
      },
      {
        onSuccess: () => setApiKey(''),
        onError: (error) => setFormError(error instanceof Error ? error.message : String(error)),
      }
    );
  };

  const handleDisconnect = () => {
    setFormError(null);
    disconnectMutation.mutate(connection.platformId, {
      onError: (error) => setFormError(error instanceof Error ? error.message : String(error)),
    });
  };

  return (
    <section className={cn('@container bg-background px-4 py-4', className)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">{platform.name}</h2>
            <Badge
              variant="outline"
              className={cn(
                connection.connected
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'bg-background text-muted-foreground'
              )}
            >
              {connection.connected ? t('maas.connected') : t('maas.notConnected')}
            </Badge>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {t(`maas.platforms.${connection.platformId}.description`)}
          </p>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void rpc.app.openExternal(platform.docsUrl)}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t('maas.connection.openDocs')}
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 grid gap-3 @2xl:grid-cols-[1fr_1fr_1fr_auto]">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t('maas.connection.displayName')}
          </span>
          <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t('maas.connection.endpoint')}
          </span>
          <Input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} />
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{apiKeyLabel}</span>
          <Input
            type="password"
            value={apiKey}
            autoComplete="new-password"
            placeholder={
              hasStoredKey
                ? t('maas.connection.apiKeyStoredPlaceholder', {
                    fingerprint: connection.keyFingerprint,
                  })
                : apiKeyPlaceholder
            }
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        <div className="flex items-end gap-2">
          <Button
            type="submit"
            disabled={saving || (!apiKey.trim() && !hasStoredKey)}
            className="min-w-28"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plug className="h-3.5 w-3.5" />
            )}
            {saving ? t('maas.connection.saving') : t('maas.connection.save')}
          </Button>
          {connection.connected && (
            <Button
              type="button"
              variant="outline"
              disabled={disconnecting}
              onClick={handleDisconnect}
              aria-label={t('maas.connection.disconnect')}
            >
              {disconnecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Unplug className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
        </div>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Key className="h-3.5 w-3.5" />
          {connection.keyFingerprint
            ? t('maas.connection.keyFingerprint', { fingerprint: connection.keyFingerprint })
            : t('maas.connection.noKey')}
        </span>
        <span className="inline-flex items-center gap-1">
          <RefreshCw className="h-3.5 w-3.5" />
          {connection.lastCheckedAt
            ? t('maas.connection.lastChecked', { time: formatDateTime(connection.lastCheckedAt) })
            : t('maas.connection.neverChecked')}
        </span>
      </div>

      {formError && <p className="mt-2 text-xs text-destructive">{formError}</p>}
    </section>
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
        <div className="space-y-2 p-4">
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
    <article className="rounded-md border border-border bg-background px-4 py-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
              meta.previewClassName
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-medium">{record.title}</h3>
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
          </div>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDateTime(record.createdAt)}
        </span>
      </div>

      <RecordMetrics record={record} />
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
            className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-background-secondary px-2 text-[11px] text-muted-foreground"
          >
            <Icon className="h-3 w-3" />
            <span>{item.label}</span>
            <span className="font-mono text-foreground-muted">{item.format(item.rawValue)}</span>
          </span>
        );
      })}
      {record.assetCount && (
        <span className="inline-flex h-6 items-center rounded-md border border-border bg-background-secondary px-2 text-[11px] text-muted-foreground">
          {t('maas.records.assets', { count: record.assetCount })}
        </span>
      )}
    </div>
  );
};
