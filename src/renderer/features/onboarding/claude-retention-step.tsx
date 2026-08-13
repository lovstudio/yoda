import { History } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ClaudeRetentionSettingsCard } from '@renderer/features/agents/components/ClaudeRetentionSettingsCard';
import { Button } from '@renderer/lib/ui/button';

export function ClaudeRetentionStep({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="@container flex h-full w-full flex-col items-center justify-center gap-6 overflow-y-auto px-8 py-8">
      <div className="flex max-w-xl flex-col items-center gap-2 text-center">
        <div className="mb-1 flex size-10 items-center justify-center rounded-full border border-border bg-background">
          <History className="size-5 text-foreground-muted" aria-hidden />
        </div>
        <h1 className="text-xl font-medium">{t('onboarding.claudeRetention.title')}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t('onboarding.claudeRetention.description')}
        </p>
      </div>
      <ClaudeRetentionSettingsCard onboarding onSaved={onComplete} />
      <Button type="button" variant="ghost" size="sm" onClick={onComplete}>
        {t('onboarding.claudeRetention.keepDefault')}
      </Button>
    </div>
  );
}
