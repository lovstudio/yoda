import { CheckCircle2, ChevronRight, Trash2, XCircle } from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiInvocationLogRecord, AiLogStatus } from '@shared/ai-logs';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { Spinner } from '@renderer/lib/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { cn } from '@renderer/utils/utils';
import { useAiLogs, useClearAiLogs } from '../use-ai-logs';

type StatusFilter = AiLogStatus | 'all';

const STATUS_FILTERS: StatusFilter[] = ['all', 'running', 'succeeded', 'failed'];

const COLUMN_COUNT = 6;

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

export const AiLogsPanel: React.FC = () => {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const { data: logs, isLoading } = useAiLogs(
    statusFilter === 'all' ? {} : { status: statusFilter }
  );
  const clearLogs = useClearAiLogs();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
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
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive"
          disabled={clearLogs.isPending || (logs?.length ?? 0) === 0}
          onClick={() => clearLogs.mutate()}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t('aiLogs.clear')}
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-10">
          <Spinner className="h-5 w-5" />
        </div>
      )}

      {!isLoading && (logs?.length ?? 0) === 0 && (
        <EmptyState label={t('aiLogs.emptyTitle')} description={t('aiLogs.emptyDescription')} />
      )}

      {!isLoading && (logs?.length ?? 0) > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border bg-background-secondary text-left text-muted-foreground">
                <th className="w-8 px-2 py-2" aria-label={t('aiLogs.col.status')} />
                <th className="px-2 py-2 font-medium">{t('aiLogs.col.purpose')}</th>
                <th className="px-2 py-2 font-medium">{t('aiLogs.col.mode')}</th>
                <th className="px-2 py-2 font-medium">{t('aiLogs.col.runtime')}</th>
                <th className="px-2 py-2 font-medium whitespace-nowrap">
                  {t('aiLogs.col.started')}
                </th>
                <th className="px-2 py-2 font-medium whitespace-nowrap">
                  {t('aiLogs.col.duration')}
                </th>
              </tr>
            </thead>
            <tbody>
              {logs?.map((record) => (
                <LogTableRow key={record.id} record={record} />
              ))}
            </tbody>
          </table>
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

const LogTableRow: React.FC<{ record: AiInvocationLogRecord }> = ({ record }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const purposeLabel = t(`aiLogs.purpose.${record.purpose}`, { defaultValue: record.purpose });

  return (
    <>
      <tr
        onClick={() => setExpanded((value) => !value)}
        className={cn(
          'cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-background-secondary',
          expanded && 'bg-background-secondary'
        )}
      >
        <td className="px-2 py-2">
          <span className="flex items-center gap-1">
            <ChevronRight
              className={cn(
                'h-3 w-3 shrink-0 text-muted-foreground transition-transform',
                expanded && 'rotate-90'
              )}
            />
            <StatusIcon status={record.status} />
          </span>
        </td>
        <td className="px-2 py-2 font-medium whitespace-nowrap">{purposeLabel}</td>
        <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">
          {t(`aiLogs.mode.${record.mode}`)}
        </td>
        <td className="max-w-44 truncate px-2 py-2 text-muted-foreground">
          {record.model ? `${record.runtime} · ${record.model}` : record.runtime}
        </td>
        <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">
          {formatTimestamp(record.startedAt)}
        </td>
        <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">
          {record.status === 'running' ? (
            <span className="text-foreground">{t('aiLogs.filter.running')}</span>
          ) : record.durationMs !== null ? (
            formatDuration(record.durationMs)
          ) : (
            '-'
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border last:border-b-0">
          <td colSpan={COLUMN_COUNT} className="bg-background-secondary/50 px-3 py-3">
            <div className="flex flex-col gap-3">
              <DetailGrid record={record} />
              {record.error && (
                <DetailBlock label={t('aiLogs.error')} value={record.error} destructive />
              )}
              {record.command && (
                <DetailBlock label={t('aiLogs.command')} value={record.command} mono />
              )}
              {record.prompt && <DetailBlock label={t('aiLogs.prompt')} value={record.prompt} />}
              {record.output && <DetailBlock label={t('aiLogs.output')} value={record.output} />}
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

const DetailGrid: React.FC<{ record: AiInvocationLogRecord }> = ({ record }) => {
  const { t } = useTranslation();
  const entries: Array<[string, string]> = [
    [t('aiLogs.started'), formatTimestamp(record.startedAt)],
    ...(record.finishedAt
      ? ([[t('aiLogs.finished'), formatTimestamp(record.finishedAt)]] as Array<[string, string]>)
      : []),
    ...(record.durationMs !== null
      ? ([[t('aiLogs.duration'), formatDuration(record.durationMs)]] as Array<[string, string]>)
      : []),
    ...Object.entries(record.metadata ?? {}),
  ];
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
      {entries.map(([label, value]) => (
        <React.Fragment key={label}>
          <span className="text-muted-foreground">{label}</span>
          <span className="break-all">{value}</span>
        </React.Fragment>
      ))}
    </div>
  );
};

const DetailBlock: React.FC<{
  label: string;
  value: string;
  mono?: boolean;
  destructive?: boolean;
}> = ({ label, value, mono, destructive }) => (
  <div className="flex flex-col gap-1">
    <span className="text-muted-foreground">{label}</span>
    <pre
      className={cn(
        'max-h-56 overflow-y-auto rounded-md border border-border bg-background px-2.5 py-2 whitespace-pre-wrap break-all',
        mono ? 'font-mono' : 'font-sans',
        destructive && 'border-destructive/20 bg-destructive/10 text-destructive'
      )}
    >
      {value}
    </pre>
  </div>
);
