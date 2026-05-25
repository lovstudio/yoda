import { Github } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/lib/ui/button';

export function GithubAuthDisclaimer({
  onOpenAccountSettings,
}: {
  onOpenAccountSettings: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex w-full flex-col items-center justify-center gap-5 rounded-md border border-border border-dashed p-8">
      <span className="relative flex size-8 items-center justify-center overflow-hidden rounded-full bg-background-2">
        <Github className="size-4 text-foreground-muted" />
      </span>
      <p className="text-center text-sm font-normal text-foreground-muted">
        {t('integrations.githubNotConnected')}
      </p>
      <Button type="button" variant="outline" size="xs" onClick={onOpenAccountSettings}>
        {t('integrations.openAccountSettings')}
      </Button>
    </div>
  );
}
