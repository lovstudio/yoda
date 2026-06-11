import { CheckCircle2, Loader2, Play, Plus, Square, Wand2, X, XCircle } from 'lucide-react';
import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SkillTriggerRunResult } from '@shared/skills/types';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { cn } from '@renderer/utils/utils';

/** Renderer-side pacing; the main process additionally caps concurrent runs. */
const RUN_CONCURRENCY = 2;

interface QueryRow {
  id: number;
  text: string;
  shouldTrigger: boolean;
  running: boolean;
  result: SkillTriggerRunResult | null;
}

let nextRowId = 1;

function makeRow(text: string, shouldTrigger: boolean): QueryRow {
  return { id: nextRowId++, text, shouldTrigger, running: false, result: null };
}

function rowPassed(row: QueryRow): boolean | null {
  if (!row.result) return null;
  if (row.result.status === 'error' || row.result.status === 'timeout') return false;
  return (row.result.status === 'triggered') === row.shouldTrigger;
}

/**
 * Trigger test for one skill: run user-style queries through headless Claude
 * and check whether the skill gets invoked. Queries come from AI generation
 * (editable) or manual entry; every run costs real model usage, so runs are
 * always user-initiated.
 */
export const SkillTriggerTest: React.FC<{ skillId: string }> = ({ skillId }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [rows, setRows] = useState<QueryRow[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const cancelRequested = useRef(false);

  const updateRow = useCallback((id: number, patch: Partial<QueryRow>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }, []);

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    try {
      const result = await rpc.skills.generateTriggerQueries({ skillId });
      if (!result.success || !result.data) {
        throw new Error(result.success ? 'empty' : (result.error ?? 'unknown'));
      }
      setRows(result.data.map((query) => makeRow(query.text, query.shouldTrigger)));
    } catch {
      toast({ title: t('skills.triggerTest.generateFailed'), variant: 'destructive' });
    } finally {
      setIsGenerating(false);
    }
  }, [skillId, t, toast]);

  const handleRun = useCallback(async () => {
    const runnable = rows.filter((row) => row.text.trim());
    if (runnable.length === 0) return;

    cancelRequested.current = false;
    setIsRunning(true);
    setRows((current) =>
      current.map((row) => ({ ...row, result: null, running: Boolean(row.text.trim()) }))
    );

    const pending = [...runnable];
    const workers = Array.from({ length: Math.min(RUN_CONCURRENCY, pending.length) }, async () => {
      while (pending.length > 0 && !cancelRequested.current) {
        const row = pending.shift();
        if (!row) break;
        try {
          const result = await rpc.skills.tryTriggerQuery({ skillId, query: row.text.trim() });
          updateRow(row.id, {
            running: false,
            result:
              result.success && result.data
                ? result.data
                : {
                    status: 'error',
                    durationMs: 0,
                    error: result.success ? 'empty' : (result.error ?? 'unknown'),
                  },
          });
        } catch (error) {
          updateRow(row.id, {
            running: false,
            result: { status: 'error', durationMs: 0, error: String(error) },
          });
        }
      }
    });
    await Promise.all(workers);

    setRows((current) => current.map((row) => ({ ...row, running: false })));
    setIsRunning(false);
  }, [rows, skillId, updateRow]);

  const handleStop = useCallback(() => {
    cancelRequested.current = true;
    void rpc.skills.cancelTriggerTest();
  }, []);

  const finished = rows.filter((row) => row.result !== null);
  const passed = finished.filter((row) => rowPassed(row) === true);
  const hasRunnableQuery = rows.some((row) => row.text.trim());

  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t('skills.triggerTest.hint')}
      </p>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          {t('skills.triggerTest.empty')}
        </p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((row) => (
            <TriggerQueryRow
              key={row.id}
              row={row}
              disabled={isRunning || isGenerating}
              onChangeText={(text) => updateRow(row.id, { text, result: null })}
              onToggleExpected={() =>
                updateRow(row.id, { shouldTrigger: !row.shouldTrigger, result: null })
              }
              onRemove={() => setRows((current) => current.filter((r) => r.id !== row.id))}
            />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleGenerate()}
          disabled={isGenerating || isRunning}
        >
          {isGenerating ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Wand2 className="mr-1.5 h-3.5 w-3.5" />
          )}
          {isGenerating ? t('skills.triggerTest.generating') : t('skills.triggerTest.generate')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={isGenerating || isRunning}
          onClick={() => setRows((current) => [...current, makeRow('', true)])}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t('skills.triggerTest.addQuery')}
        </Button>
        {isRunning ? (
          <Button variant="outline" size="sm" onClick={handleStop}>
            <Square className="mr-1.5 h-3.5 w-3.5" />
            {t('skills.triggerTest.stop')}
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => void handleRun()}
            disabled={!hasRunnableQuery || isGenerating}
          >
            <Play className="mr-1.5 h-3.5 w-3.5" />
            {t('skills.triggerTest.run')}
          </Button>
        )}
        {finished.length > 0 && !isRunning && (
          <span className="text-[11px] text-muted-foreground">
            {t('skills.triggerTest.summary', { passed: passed.length, total: finished.length })}
          </span>
        )}
      </div>
    </div>
  );
};

const TriggerQueryRow: React.FC<{
  row: QueryRow;
  disabled: boolean;
  onChangeText: (text: string) => void;
  onToggleExpected: () => void;
  onRemove: () => void;
}> = ({ row, disabled, onChangeText, onToggleExpected, onRemove }) => {
  const { t } = useTranslation();
  const passedState = rowPassed(row);

  return (
    <div className="group/trigger-row flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/20 px-2 py-1.5">
      <button
        type="button"
        onClick={onToggleExpected}
        disabled={disabled}
        title={t('skills.triggerTest.toggleExpected')}
        className={cn(
          'shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors',
          row.shouldTrigger
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-border bg-muted/40 text-muted-foreground'
        )}
      >
        {row.shouldTrigger
          ? t('skills.triggerTest.expectTrigger')
          : t('skills.triggerTest.expectNoTrigger')}
      </button>
      <Input
        value={row.text}
        onChange={(event) => onChangeText(event.target.value)}
        placeholder={t('skills.triggerTest.queryPlaceholder')}
        disabled={disabled}
        className="h-7 min-w-0 flex-1 border-none bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
      />
      <TriggerResultChip row={row} passedState={passedState} />
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onRemove}
        disabled={disabled}
        aria-label={t('skills.triggerTest.removeQuery')}
        className="shrink-0 opacity-0 transition-opacity group-hover/trigger-row:opacity-100"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
};

const TriggerResultChip: React.FC<{ row: QueryRow; passedState: boolean | null }> = ({
  row,
  passedState,
}) => {
  const { t } = useTranslation();

  if (row.running) {
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />;
  }
  if (!row.result || passedState === null) return null;

  const label =
    row.result.status === 'triggered'
      ? t('skills.triggerTest.status.triggered')
      : row.result.status === 'not-triggered'
        ? t('skills.triggerTest.status.notTriggered')
        : row.result.status === 'other-skill'
          ? t('skills.triggerTest.status.otherSkill', { skill: row.result.matchedSkill ?? '?' })
          : row.result.status === 'timeout'
            ? t('skills.triggerTest.status.timeout')
            : t('skills.triggerTest.status.error');

  return (
    <span
      title={row.result.error}
      className={cn(
        'flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium',
        passedState
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
      )}
    >
      {passedState ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {label}
    </span>
  );
};
