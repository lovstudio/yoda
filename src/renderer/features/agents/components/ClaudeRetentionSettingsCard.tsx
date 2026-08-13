import { Check, Copy, Loader2, Save } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CLAUDE_DEFAULT_CLEANUP_PERIOD_DAYS,
  CLAUDE_RECOMMENDED_CLEANUP_PERIOD_DAYS,
} from '@shared/claude-retention';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { Alert, AlertAction, AlertDescription } from '@renderer/lib/ui/alert';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { isImeComposing } from '@renderer/utils/ime';
import { cn } from '@renderer/utils/utils';
import { useClaudeRetentionSettings } from '../use-claude-retention-settings';

const PRESETS = [30, 90, 365, CLAUDE_RECOMMENDED_CLEANUP_PERIOD_DAYS] as const;

export function ClaudeRetentionSettingsCard({
  onboarding = false,
  onSaved,
}: {
  onboarding?: boolean;
  onSaved?: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data, isLoading, isSaving, error, saveError, save, resetSaveError } =
    useClaudeRetentionSettings();
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!data || draft) return;
    setDraft(
      String(
        onboarding && !data.configured
          ? CLAUDE_RECOMMENDED_CLEANUP_PERIOD_DAYS
          : data.effectiveCleanupPeriodDays
      )
    );
  }, [data, draft, onboarding]);

  const days = Number(draft);
  const valid = Number.isInteger(days) && days >= 1;
  const unchanged = data?.configured && days === data.cleanupPeriodDays;
  const diagnostic = String(saveError ?? error ?? '');

  const handleSave = async () => {
    if (!valid) return;
    resetSaveError();
    try {
      await save(days);
      toast({ title: t('agents.retention.saved', { days }) });
      onSaved?.();
    } catch {
      // The inline diagnostic remains visible and copyable.
    }
  };

  const copyDiagnostic = async () => {
    if (!diagnostic || !navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(diagnostic);
    toast({ title: t('agents.retention.errorCopied') });
  };

  if (isLoading && !data) {
    return (
      <div className="flex min-h-24 items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', onboarding && 'w-full max-w-xl')}>
      <div className="grid grid-cols-2 gap-2 @sm:grid-cols-4">
        {PRESETS.map((preset) => {
          const selected = days === preset;
          return (
            <button
              key={preset}
              type="button"
              aria-pressed={selected}
              onClick={() => setDraft(String(preset))}
              disabled={isSaving}
              className={cn(
                'relative flex min-h-14 flex-col items-start justify-center rounded-lg border px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected
                  ? 'border-foreground/35 bg-muted/50 text-foreground'
                  : 'border-border/70 text-muted-foreground hover:border-border hover:bg-muted/25'
              )}
            >
              <span className="text-sm font-medium tabular-nums">
                {preset === CLAUDE_RECOMMENDED_CLEANUP_PERIOD_DAYS
                  ? t('agents.retention.tenYears')
                  : t('agents.retention.days', { days: preset })}
              </span>
              <span className="text-[10px] leading-tight text-foreground-passive">
                {preset === CLAUDE_DEFAULT_CLEANUP_PERIOD_DAYS
                  ? t('agents.retention.default')
                  : preset === CLAUDE_RECOMMENDED_CLEANUP_PERIOD_DAYS
                    ? t('agents.retention.recommended')
                    : t('agents.retention.preset')}
              </span>
              {selected && <Check className="absolute right-2 top-2 size-3.5" aria-hidden />}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-40 flex-1 space-y-1.5">
          <span className="text-xs font-medium">{t('agents.retention.customLabel')}</span>
          <Input
            type="number"
            min={1}
            step={1}
            value={draft}
            disabled={isSaving}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !isImeComposing(event)) void handleSave();
            }}
            aria-invalid={!valid}
            className="h-9 font-mono text-xs"
          />
        </label>
        <Button
          type="button"
          onClick={() => void handleSave()}
          disabled={!valid || isSaving || Boolean(unchanged)}
          className="h-9 gap-1.5"
        >
          {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          {onboarding ? t('agents.retention.saveAndContinue') : t('common.save')}
        </Button>
      </div>

      {!valid && draft !== '' && (
        <p className="text-xs text-destructive">{t('agents.retention.invalid')}</p>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t('agents.retention.scopeHint')}
      </p>

      {diagnostic && (
        <Alert variant="destructive">
          <AlertDescription className="break-all pr-8 font-mono text-[11px]">
            {diagnostic}
          </AlertDescription>
          <AlertAction>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              title={t('agents.retention.copyError')}
              aria-label={t('agents.retention.copyError')}
              onClick={() => void copyDiagnostic()}
            >
              <Copy className="size-3.5" />
            </Button>
          </AlertAction>
        </Alert>
      )}
    </div>
  );
}
