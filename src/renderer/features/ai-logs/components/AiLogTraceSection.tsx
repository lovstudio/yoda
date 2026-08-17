import {
  Bot,
  Brain,
  ChevronRight,
  CornerDownRight,
  MessageSquare,
  Scissors,
  Wrench,
} from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiLogStep, AiLogStepKind, AiLogStepTokens } from '@shared/ai-log-steps';
import { Spinner } from '@renderer/lib/ui/spinner';
import { formatCompactNumber } from '@renderer/utils/format-compact-number';
import { cn } from '@renderer/utils/utils';
import { formatStepGap } from '../log-format';
import { useAiLogTrace } from '../use-ai-logs';

const STEP_ICONS: Record<AiLogStepKind, React.ComponentType<{ className?: string }>> = {
  prompt: MessageSquare,
  thinking: Brain,
  text: Bot,
  'tool-use': Wrench,
  'tool-result': CornerDownRight,
  compact: Scissors,
};

/**
 * What happened between the prompt and the answer: every API response, its
 * thinking, the tools it called and what each request cost. Read from the
 * provider transcript when the row is opened, so nothing here is a
 * reconstruction — an unreadable trace says why instead of showing an empty
 * timeline.
 */
export const AiLogTraceSection: React.FC<{ logId: string; live: boolean }> = ({ logId, live }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const { data: trace, isLoading } = useAiLogTrace(logId, { live, enabled: true });

  if (isLoading) {
    return (
      <TraceFrame>
        <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Spinner className="h-3 w-3" />
          {t('aiLogs.trace.loading')}
        </span>
      </TraceFrame>
    );
  }
  if (!trace) return null;
  if (trace.unavailable) {
    return (
      <TraceFrame>
        <p className="text-[11px] leading-5 text-muted-foreground">
          {t(`aiLogs.trace.unavailable.${trace.unavailable}`)}
        </p>
      </TraceFrame>
    );
  }

  return (
    <TraceFrame
      summary={t('aiLogs.trace.summary', {
        requests: trace.requestCount,
        tokens: formatTokenSummary(trace.tokens, t),
      })}
      expanded={expanded}
      onToggle={() => setExpanded((value) => !value)}
    >
      <ol className="flex flex-col">
        {trace.steps.map((step) => (
          <StepRow key={step.index} step={step} />
        ))}
      </ol>
      {trace.totalSteps > trace.steps.length && (
        <p className="pt-1 text-[11px] text-muted-foreground">
          {t('aiLogs.trace.capped', { shown: trace.steps.length, total: trace.totalSteps })}
        </p>
      )}
      {trace.transcriptPath && (
        <p
          className="truncate pt-1 font-mono text-[10px] text-muted-foreground/70"
          title={trace.transcriptPath}
        >
          {trace.transcriptPath}
        </p>
      )}
    </TraceFrame>
  );
};

const TraceFrame: React.FC<{
  summary?: string;
  expanded?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}> = ({ summary, expanded, onToggle, children }) => {
  const { t } = useTranslation();
  const title = (
    <span className="text-xs font-medium text-muted-foreground">{t('aiLogs.trace.title')}</span>
  );
  const detail = summary && (
    <span className="truncate text-[11px] text-muted-foreground tabular-nums">{summary}</span>
  );

  return (
    <section className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border bg-background px-2.5 py-2">
      {onToggle ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex items-baseline gap-2 text-left"
        >
          <ChevronRight
            className={cn(
              'h-3 w-3 shrink-0 self-center text-muted-foreground transition-transform',
              expanded && 'rotate-90'
            )}
          />
          {title}
          <span className="ml-auto min-w-0">{detail}</span>
        </button>
      ) : (
        <div className="flex items-baseline justify-between gap-3">
          {title}
          {detail}
        </div>
      )}
      {(expanded === undefined || expanded) && children}
    </section>
  );
};

const StepRow: React.FC<{ step: AiLogStep }> = ({ step }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const Icon = STEP_ICONS[step.kind];
  const gap = formatStepGap(step.sinceMs);
  const label = step.label ?? t(`aiLogs.trace.kind.${step.kind}`);
  const expandable = Boolean(step.detail);

  return (
    <li
      className={cn(
        'flex min-w-0 items-start gap-2 border-b border-border/40 py-1 last:border-b-0',
        step.sidechain && 'opacity-70'
      )}
    >
      <span className="w-12 shrink-0 pt-0.5 text-right text-[10px] whitespace-nowrap text-muted-foreground tabular-nums">
        {gap}
      </span>
      <Icon
        className={cn(
          'mt-0.5 h-3 w-3 shrink-0',
          step.isError ? 'text-destructive' : 'text-muted-foreground'
        )}
      />
      <button
        type="button"
        disabled={!expandable}
        aria-expanded={expandable ? expanded : undefined}
        onClick={() => setExpanded((value) => !value)}
        className={cn('min-w-0 flex-1 text-left', !expandable && 'cursor-default')}
      >
        <span
          className={cn(
            'text-[11px] font-medium',
            step.isError ? 'text-destructive' : 'text-foreground'
          )}
        >
          {label}
        </span>
        {step.detail && (
          <span
            className={cn(
              'block text-[11px] leading-5 break-words text-muted-foreground',
              expanded ? 'whitespace-pre-wrap' : 'line-clamp-2'
            )}
          >
            {step.detail}
          </span>
        )}
        {expanded && step.clippedChars > 0 && (
          <span className="block pt-0.5 text-[10px] text-muted-foreground/70">
            {t('aiLogs.trace.clipped', { count: step.clippedChars })}
          </span>
        )}
      </button>
      {step.tokens && (
        <span
          className="shrink-0 pt-0.5 text-right text-[10px] whitespace-nowrap text-muted-foreground tabular-nums"
          title={formatTokenSummary(step.tokens, t)}
        >
          {t('aiLogs.trace.stepTokens', {
            input: formatCompactNumber(step.tokens.input + step.tokens.cached),
            output: formatCompactNumber(step.tokens.output),
          })}
        </span>
      )}
    </li>
  );
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

function formatTokenSummary(tokens: AiLogStepTokens, t: Translate): string {
  return t('aiLogs.trace.tokens', {
    input: formatCompactNumber(tokens.input),
    cached: formatCompactNumber(tokens.cached),
    output: formatCompactNumber(tokens.output),
  });
}
