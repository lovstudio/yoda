import { History } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/lib/ui/button';
import { useClaudeRetentionSettings } from '../use-claude-retention-settings';

export function ClaudeRetentionNotice({ onConfigure }: { onConfigure: () => void }) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useClaudeRetentionSettings();
  if (isLoading || error || data?.configured) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border/60 bg-amber-500/[0.055] px-4 py-2.5">
      <History className="size-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
      <p className="min-w-56 flex-1 text-xs leading-relaxed text-foreground-muted">
        {t('agents.retention.notice', { days: data?.effectiveCleanupPeriodDays ?? 30 })}
      </p>
      <Button type="button" size="sm" variant="outline" onClick={onConfigure}>
        {t('agents.retention.configure')}
      </Button>
    </div>
  );
}
