import {
  CheckCircle2,
  ChevronRight,
  Code2,
  Copy,
  ListTree,
  Maximize2,
  Minimize2,
  Trash2,
  XCircle,
} from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiInvocationLogRecord, AiLogStatus } from '@shared/ai-logs';
import { HeaderActionButton, HeaderActionToolbar } from '@renderer/lib/components/header-actions';
import { copyTextToClipboard, useToast } from '@renderer/lib/hooks/use-toast';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { Spinner } from '@renderer/lib/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { cn } from '@renderer/utils/utils';
import { useAiLogs, useClearAiLogs } from '../use-ai-logs';

type StatusFilter = AiLogStatus | 'all';

const STATUS_FILTERS: StatusFilter[] = ['all', 'running', 'succeeded', 'failed'];

const COLUMN_COUNT = 6;
const MAX_DEBUG_COMMAND_CHARS = 4_000;
const REDACTED_VALUE = '[REDACTED]';
const SENSITIVE_FIELD_PATTERN =
  /(?:api[-_]?key|authorization|credential|password|private[-_]?key|secret|token)/i;
const ALWAYS_COLLAPSED_COMMAND_CONFIGS = new Set(['developer_instructions', 'notify']);
const COLLAPSED_COMMAND_VALUE_THRESHOLD = 160;

type CommandConfigSegment = {
  key: string;
  valueStart: number;
  valueEnd: number;
};

function findCommandConfigValueEnd(command: string, start: number): number {
  const opener = command[start];
  if (opener === '"' || opener === "'") {
    for (let index = start + 1; index < command.length; index += 1) {
      if (command[index] === '\\') {
        index += 1;
      } else if (command[index] === opener) {
        return index + 1;
      }
    }
    return command.length;
  }

  const closer = opener === '[' ? ']' : opener === '{' ? '}' : undefined;
  if (closer) {
    let depth = 0;
    let quote: '"' | "'" | undefined;
    for (let index = start; index < command.length; index += 1) {
      const character = command[index];
      if (quote) {
        if (character === '\\') index += 1;
        else if (character === quote) quote = undefined;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
      } else if (character === opener) {
        depth += 1;
      } else if (character === closer) {
        depth -= 1;
        if (depth === 0) return index + 1;
      }
    }
    return command.length;
  }

  const nextWhitespace = command.slice(start).search(/\s/);
  return nextWhitespace === -1 ? command.length : start + nextWhitespace;
}

function findCommandConfigSegments(command: string): CommandConfigSegment[] {
  const segments: CommandConfigSegment[] = [];
  const configPattern = /(?:^|\s)-c\s+([A-Za-z0-9_.-]+)=/g;
  let match: RegExpExecArray | null;
  while ((match = configPattern.exec(command))) {
    const valueStart = configPattern.lastIndex;
    const valueEnd = findCommandConfigValueEnd(command, valueStart);
    segments.push({ key: match[1], valueStart, valueEnd });
    configPattern.lastIndex = Math.max(valueEnd, configPattern.lastIndex);
  }
  return segments;
}

function splitCommandWords(command: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (character === '\\' && index + 1 < command.length) {
      current += character + command[index + 1];
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      if (!quote) quote = character;
      else if (quote === character) quote = undefined;
      current += character;
      continue;
    }
    if (/\s/.test(character) && !quote) {
      if (current) words.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  if (current) words.push(current);
  return words;
}

export function buildCompactCommand(
  command: string,
  collapsedValue: (characterCount: number) => string = (count) => `<collapsed:${count}-chars>`
): string {
  const replacements = new Map<string, string>();
  let compactSource = '';
  let cursor = 0;

  for (const [index, segment] of findCommandConfigSegments(command).entries()) {
    const value = command.slice(segment.valueStart, segment.valueEnd);
    if (
      !ALWAYS_COLLAPSED_COMMAND_CONFIGS.has(segment.key) &&
      value.length <= COLLAPSED_COMMAND_VALUE_THRESHOLD
    ) {
      continue;
    }
    const marker = `__YODA_COMMAND_VALUE_${index}__`;
    compactSource += command.slice(cursor, segment.valueStart) + marker;
    cursor = segment.valueEnd;
    replacements.set(marker, collapsedValue(value.length));
  }
  compactSource += command.slice(cursor);

  const words = splitCommandWords(compactSource).map((word) => {
    let resolved = word;
    for (const [marker, replacement] of replacements) {
      resolved = resolved.replace(marker, replacement);
    }
    return resolved;
  });
  if (words.length <= 1) return command;

  const lines = [words[0]];
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index];
    const next = words[index + 1];
    if (word.startsWith('-') && next && !next.startsWith('-')) {
      lines.push(`  ${word} ${next}`);
      index += 1;
    } else {
      lines.push(`  ${word}`);
    }
  }
  return lines.join('\n');
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/(\bBearer\s+)[^\s"'\\]+/gi, `$1${REDACTED_VALUE}`)
    .replace(/((?:authorization|x-api-key|x-yoda-token)\s*:\s*)[^\s"'\\]+/gi, `$1${REDACTED_VALUE}`)
    .replace(
      /((?:api[-_]?key|credential|password|private[-_]?key|secret|token)(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?)[^\s,"';\\]+/gi,
      `$1${REDACTED_VALUE}`
    );
}

function clipDebugCommand(value: string | null): string | null {
  if (!value) return null;
  const redacted = redactSensitiveText(value);
  if (redacted.length <= MAX_DEBUG_COMMAND_CHARS) return redacted;
  return `${redacted.slice(0, MAX_DEBUG_COMMAND_CHARS)}\n… [clipped ${redacted.length - MAX_DEBUG_COMMAND_CHARS} chars]`;
}

function sanitizeMetadata(metadata: Record<string, string> | null): Record<string, string> | null {
  if (!metadata) return null;
  return Object.fromEntries(
    Object.entries(metadata)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [
        key,
        SENSITIVE_FIELD_PATTERN.test(key) ? REDACTED_VALUE : redactSensitiveText(value),
      ])
  );
}

export function buildAiLogDebugInformation(record: AiInvocationLogRecord): string {
  return JSON.stringify(
    {
      schema: 'yoda-ai-log-debug/v1',
      log: {
        id: record.id,
        purpose: record.purpose,
        mode: record.mode,
        runtime: record.runtime,
        model: record.model,
        status: record.status,
        command: clipDebugCommand(record.command),
        error: record.error ? redactSensitiveText(record.error) : null,
        metadata: sanitizeMetadata(record.metadata),
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        durationMs: record.durationMs,
      },
      omittedContent: {
        promptChars: record.prompt?.length ?? 0,
        outputChars: record.output?.length ?? 0,
      },
    },
    null,
    2
  );
}

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
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const purposeLabel = t(`aiLogs.purpose.${record.purpose}`, { defaultValue: record.purpose });

  const copyDebugInformation = async (): Promise<void> => {
    try {
      await copyTextToClipboard(buildAiLogDebugInformation(record));
      toast.success(t('common.debugInfoCopied'));
    } catch {
      toast.error(t('common.copyFailed'));
    }
  };

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
              <div className="flex justify-end">
                <Button
                  size="xs"
                  variant="outline"
                  aria-label={t('common.copyDebugInfo')}
                  onClick={() => void copyDebugInformation()}
                >
                  <Copy className="size-3" />
                  {t('common.copyDebugInfo')}
                </Button>
              </div>
              <DetailGrid record={record} />
              {record.error && (
                <DetailBlock label={t('aiLogs.error')} value={record.error} destructive mono />
              )}
              {record.command && (
                <DetailBlock
                  label={t('aiLogs.command')}
                  value={record.command}
                  mono
                  compactCommand
                />
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
  compactCommand?: boolean;
}> = ({ label, value, mono, destructive, compactCommand }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [fullyExpanded, setFullyExpanded] = useState(false);
  const [showRawCommand, setShowRawCommand] = useState(false);
  const compactValue = compactCommand
    ? buildCompactCommand(value, (count) => t('aiLogs.commandValueCollapsed', { count }))
    : undefined;
  const displayedValue = compactValue && !showRawCommand ? compactValue : value;
  const copyLabel = t('aiLogs.copyDetail', { label });
  const resizeLabel = t(fullyExpanded ? 'aiLogs.collapseDetail' : 'aiLogs.expandDetail', {
    label,
  });

  const copyValue = async (): Promise<void> => {
    try {
      await copyTextToClipboard(value);
      toast.success(t('aiLogs.detailCopied', { label }));
    } catch {
      toast.error(t('common.copyFailed'));
    }
  };

  return (
    <section
      className={cn(
        'overflow-hidden rounded-md border border-border bg-background',
        destructive && 'border-destructive/25 bg-destructive/5'
      )}
    >
      <div className="flex min-h-8 items-center justify-between gap-2 border-b border-border px-2.5 py-1">
        <span
          className={cn(
            'min-w-0 truncate text-xs font-medium text-muted-foreground',
            destructive && 'text-destructive'
          )}
        >
          {label}
        </span>
        <HeaderActionToolbar label={t('aiLogs.detailActions', { label })}>
          <HeaderActionButton label={copyLabel} onClick={() => void copyValue()}>
            <Copy className="size-3" />
          </HeaderActionButton>
          {compactValue && (
            <HeaderActionButton
              label={t(showRawCommand ? 'aiLogs.showCompactCommand' : 'aiLogs.showRawCommand')}
              aria-pressed={showRawCommand}
              onClick={() => setShowRawCommand((value) => !value)}
            >
              {showRawCommand ? <ListTree className="size-3" /> : <Code2 className="size-3" />}
            </HeaderActionButton>
          )}
          <HeaderActionButton
            label={resizeLabel}
            aria-expanded={fullyExpanded}
            onClick={() => setFullyExpanded((value) => !value)}
          >
            {fullyExpanded ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
          </HeaderActionButton>
        </HeaderActionToolbar>
      </div>
      <pre
        tabIndex={0}
        aria-label={label}
        className={cn(
          'overflow-auto px-2.5 py-2 text-xs leading-5 whitespace-pre-wrap break-words [scrollbar-gutter:stable]',
          fullyExpanded ? 'max-h-[min(60vh,40rem)]' : 'max-h-32',
          mono ? 'font-mono' : 'font-sans',
          destructive && 'text-destructive'
        )}
      >
        {displayedValue}
      </pre>
    </section>
  );
};
