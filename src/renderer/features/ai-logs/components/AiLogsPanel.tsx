import { CheckCircle2, ChevronRight, Copy, Trash2, XCircle } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiInvocationLogRecord, AiLogStatus } from '@shared/ai-logs';
import { copyTextToClipboard, useToast } from '@renderer/lib/hooks/use-toast';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { SearchInput } from '@renderer/lib/ui/search-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Spinner } from '@renderer/lib/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { cn } from '@renderer/utils/utils';
import { buildAiLogDebugInformation } from '../log-debug-info';
import { formatDuration, formatTimestamp } from '../log-format';
import {
  AI_LOG_CATEGORIES,
  aiLogPreview,
  countAiLogStatuses,
  diagnoseAiLogFailure,
  extraAiLogMetadata,
  filterAiLogGroups,
  groupAiLogs,
  type AiLogCategory,
} from '../log-presentation';
import { useAiLogs, useClearAiLogs } from '../use-ai-logs';
import { AiLogDetailBlock } from './AiLogDetailBlock';
import { AiLogTraceSection } from './AiLogTraceSection';

type StatusFilter = AiLogStatus | 'all';
type CategoryFilter = AiLogCategory | 'all';

const STATUS_FILTERS: StatusFilter[] = ['all', 'running', 'succeeded', 'failed'];
const CATEGORY_FILTERS: CategoryFilter[] = ['all', ...AI_LOG_CATEGORIES];

export const AiLogsPanel: React.FC = () => {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [query, setQuery] = useState('');
  const { data: logs, isLoading } = useAiLogs(
    statusFilter === 'all' ? {} : { status: statusFilter }
  );
  const clearLogs = useClearAiLogs();

  const counts = useMemo(() => countAiLogStatuses(logs ?? []), [logs]);
  const groups = useMemo(
    () => filterAiLogGroups(groupAiLogs(logs ?? []), { category: categoryFilter, query }),
    [logs, categoryFilter, query]
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          multiple={false}
          value={[statusFilter]}
          onValueChange={([value]) => {
            if (value) setStatusFilter(value as StatusFilter);
          }}
        >
          {STATUS_FILTERS.map((filter) => (
            <ToggleGroupItem key={filter} value={filter} className="text-xs">
              {t(`aiLogs.filter.${filter}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Select
          value={categoryFilter}
          onValueChange={(value) => setCategoryFilter(value as CategoryFilter)}
        >
          <SelectTrigger aria-label={t('aiLogs.categoryLabel')} className="h-8 w-32">
            <SelectValue>
              {(value: string | null) => t(`aiLogs.category.${value ?? 'all'}`)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {CATEGORY_FILTERS.map((filter) => (
              <SelectItem key={filter} value={filter}>
                {t(`aiLogs.category.${filter}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SearchInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('aiLogs.searchPlaceholder')}
          aria-label={t('aiLogs.searchPlaceholder')}
          className="h-8 w-52 text-xs"
        />
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-muted-foreground hover:text-destructive"
          disabled={clearLogs.isPending || counts.total === 0}
          onClick={() => clearLogs.mutate()}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t('aiLogs.clear')}
        </Button>
      </div>

      {counts.total > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>{t('aiLogs.summary.total', { count: counts.total })}</span>
          <span>{t('aiLogs.summary.succeeded', { count: counts.succeeded })}</span>
          <span className={cn(counts.failed > 0 && 'text-destructive')}>
            {t('aiLogs.summary.failed', { count: counts.failed })}
          </span>
          {counts.running > 0 && (
            <span>{t('aiLogs.summary.running', { count: counts.running })}</span>
          )}
        </p>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-10">
          <Spinner className="h-5 w-5" />
        </div>
      )}

      {!isLoading && counts.total === 0 && (
        <EmptyState label={t('aiLogs.emptyTitle')} description={t('aiLogs.emptyDescription')} />
      )}

      {!isLoading && counts.total > 0 && groups.length === 0 && (
        <EmptyState label={t('aiLogs.noMatchTitle')} description={t('aiLogs.noMatchDescription')} />
      )}

      {!isLoading && groups.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border">
          {groups.map((group) => (
            <div
              key={group.record.id}
              className="border-b border-border last:border-b-0"
              data-testid="ai-log-group"
            >
              <LogRow record={group.record} />
              {group.children.map((child) => (
                <div key={child.id} className="border-t border-border/60 pl-5">
                  <LogRow record={child} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const StatusIcon: React.FC<{ status: AiLogStatus }> = ({ status }) => {
  if (status === 'running') return <Spinner className="h-3.5 w-3.5 shrink-0" />;
  if (status === 'succeeded')
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />;
  return <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />;
};

const LogRow: React.FC<{ record: AiInvocationLogRecord }> = ({ record }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const purposeLabel = t(`aiLogs.purpose.${record.purpose}`, { defaultValue: record.purpose });
  const preview = aiLogPreview(record);

  return (
    <div>
      <button
        type="button"
        data-testid="ai-log-row"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className={cn(
          'flex w-full items-start gap-2 px-2 py-2 text-left transition-colors hover:bg-background-secondary',
          expanded && 'bg-background-secondary'
        )}
      >
        <ChevronRight
          className={cn(
            'mt-0.5 h-3 w-3 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-90'
          )}
        />
        <span className="mt-0.5">
          <StatusIcon status={record.status} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-xs font-medium">{purposeLabel}</span>
            <span className="text-[11px] text-muted-foreground">
              {record.model ? `${record.runtime} · ${record.model}` : record.runtime}
            </span>
          </span>
          {preview && (
            <span className="line-clamp-1 text-[11px] break-all text-muted-foreground">
              {preview}
            </span>
          )}
        </span>
        <span className="shrink-0 pt-0.5 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">
          {formatTimestamp(record.startedAt)}
        </span>
        <span className="w-14 shrink-0 pt-0.5 text-right text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">
          {record.status === 'running'
            ? t('aiLogs.filter.running')
            : record.durationMs !== null
              ? formatDuration(record.durationMs)
              : '-'}
        </span>
      </button>
      {expanded && <LogDetail record={record} />}
    </div>
  );
};

const LogDetail: React.FC<{ record: AiInvocationLogRecord }> = ({ record }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const description = t(`aiLogs.purposeDescription.${record.purpose}`, { defaultValue: '' });
  const diagnosis = diagnoseAiLogFailure(record);
  const extraMetadata = extraAiLogMetadata(record);
  const authProvider = record.metadata?.authProvider;
  const maasPlatformId = record.metadata?.maasPlatformId?.replace(/^profile:/, '');
  const endpoint = record.metadata?.endpoint;
  const agentName = record.metadata?.agent;

  const copyDebugInformation = async (): Promise<void> => {
    try {
      await copyTextToClipboard(buildAiLogDebugInformation(record));
      toast.success(t('common.debugInfoCopied'));
    } catch {
      toast.error(t('common.copyFailed'));
    }
  };

  return (
    <div className="flex flex-col gap-3 border-t border-border bg-background-secondary/40 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-[11px] leading-5 text-muted-foreground">{description}</p>
        <Button
          size="xs"
          variant="outline"
          className="shrink-0"
          aria-label={t('common.copyDebugInfo')}
          onClick={() => void copyDebugInformation()}
        >
          <Copy className="size-3" />
          {t('common.copyDebugInfo')}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <MetaChip label={t('aiLogs.chip.mode')} value={t(`aiLogs.mode.${record.mode}`)} />
        <MetaChip label={t('aiLogs.chip.runtime')} value={record.runtime} />
        {record.model && <MetaChip label={t('aiLogs.chip.model')} value={record.model} />}
        {agentName && <MetaChip label={t('aiLogs.chip.agent')} value={agentName} />}
        <MetaChip
          label={t('aiLogs.chip.account')}
          value={
            authProvider
              ? [
                  t(`agents.runtimeInfo.authProviders.${authProvider}`, {
                    defaultValue: authProvider,
                  }),
                  maasPlatformId,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : t('aiLogs.account.unrecorded')
          }
          hint={authProvider ? undefined : t('aiLogs.account.unrecordedHint')}
        />
        <MetaChip
          label={t('aiLogs.chip.endpoint')}
          value={endpoint ?? t('aiLogs.endpoint.clientManaged')}
          hint={endpoint ? t('aiLogs.endpoint.overriddenHint') : t('aiLogs.endpoint.clientHint')}
        />
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          {t('aiLogs.started')} {formatTimestamp(record.startedAt)}
        </span>
        {record.finishedAt && (
          <span>
            {t('aiLogs.finished')} {formatTimestamp(record.finishedAt)}
          </span>
        )}
        {record.durationMs !== null && (
          <span>
            {t('aiLogs.duration')} {formatDuration(record.durationMs)}
          </span>
        )}
      </div>

      {diagnosis && (
        <p className="rounded-md border border-destructive/25 bg-destructive/5 px-2.5 py-2 text-xs leading-5 text-destructive">
          {t(`aiLogs.diagnosis.${diagnosis}`)}
        </p>
      )}

      {record.error && (
        <AiLogDetailBlock label={t('aiLogs.error')} value={record.error} destructive mono />
      )}

      {(record.prompt || record.output) && (
        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          {record.prompt && <AiLogDetailBlock label={t('aiLogs.prompt')} value={record.prompt} />}
          {record.output && <AiLogDetailBlock label={t('aiLogs.output')} value={record.output} />}
        </div>
      )}

      {record.metadata?.conversationId && (
        <AiLogTraceSection logId={record.id} live={record.status === 'running'} />
      )}

      {record.command && (
        <AiLogDetailBlock label={t('aiLogs.command')} value={record.command} mono compactCommand />
      )}

      {extraMetadata.length > 0 && (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[11px]">
          {extraMetadata.map(([key, value]) => (
            <React.Fragment key={key}>
              <span className="text-muted-foreground">
                {t(`aiLogs.metadata.${key}`, { defaultValue: key })}
              </span>
              <span className="font-mono break-all">{value}</span>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};

const MetaChip: React.FC<{ label: string; value: string; hint?: string }> = ({
  label,
  value,
  hint,
}) => (
  <Badge variant="secondary" className="h-5 max-w-full gap-1 px-2" title={hint}>
    <span className="text-muted-foreground">{label}</span>
    <span className="truncate text-foreground">{value}</span>
  </Badge>
);
