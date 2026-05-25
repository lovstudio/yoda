import { AlertCircle, CheckCircle2, Loader2, RotateCcw, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { getPrSyncStore } from '@renderer/features/projects/stores/project-selectors';
import { ListPopoverCard } from '@renderer/lib/components/list-popover-card';
import { Button } from '@renderer/lib/ui/button';

interface SyncStatusCardProps {
  icon: ReactNode;
  label?: ReactNode;
  content: ReactNode;
  actions?: ReactNode;
  className?: string;
}

function SyncStatusCard({ icon, label, content, actions, className }: SyncStatusCardProps) {
  return (
    <ListPopoverCard className={className}>
      {icon}
      {label && <span className="text-foreground-muted shrink-0">{label}</span>}

      <span className="text-foreground-passive grow min-w-0">{content}</span>
      {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
    </ListPopoverCard>
  );
}

interface Props {
  projectId: string;
  repositoryUrl: string;
}

export const PrSyncStatusCard = observer(function PrSyncStatusCard({
  projectId,
  repositoryUrl,
}: Props) {
  const { t } = useTranslation();
  const prSync = getPrSyncStore(projectId);
  const state = prSync?.getState(repositoryUrl);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    if (state?.status === 'done') {
      setShowSuccess(true);
      const timer = setTimeout(() => {
        setShowSuccess(false);
        prSync?.clear(repositoryUrl);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [state?.status, prSync, repositoryUrl]);

  if (showSuccess) {
    return (
      <SyncStatusCard
        icon={<CheckCircle2 className="size-3.5 shrink-0 text-green-500" />}
        content={t('pullRequests.sync.complete')}
      />
    );
  }

  if (!state || state.status === 'done') return null;

  const kindLabel = t(`pullRequests.sync.kind.${state.kind}`, { defaultValue: state.kind });

  if (state.status === 'running' && state.kind !== 'single') {
    const hasProgress = state.total != null && state.total > 0;
    return (
      <SyncStatusCard
        icon={<Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
        label={kindLabel}
        content={
          hasProgress
            ? t('pullRequests.sync.syncingProgress', {
                synced: state.synced ?? 0,
                total: state.total,
              })
            : t('pullRequests.sync.syncing')
        }
        actions={
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 h-6 px-2 text-xs"
            onClick={() => prSync?.cancel(repositoryUrl)}
          >
            {t('common.cancel')}
          </Button>
        }
      />
    );
  }

  if (state.status === 'cancelled' && state.kind !== 'single') {
    return (
      <SyncStatusCard
        icon={<RotateCcw className="size-3.5 shrink-0 text-muted-foreground" />}
        label={kindLabel}
        content={t('pullRequests.sync.cancelled')}
        actions={
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => prSync?.retry()}
          >
            {t('common.resume')}
          </Button>
        }
      />
    );
  }

  // error state
  return (
    <SyncStatusCard
      icon={<AlertCircle className="size-3.5 shrink-0 text-foreground-destructive" />}
      label={<span className="text-destructive font-medium">{t('pullRequests.sync.failed')}</span>}
      content={
        <span className="block truncate" title={state.error}>
          {state.error ?? t('common.unknownError')}
        </span>
      }
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => prSync?.retry()}
          >
            {t('common.retry')}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => prSync?.clear(repositoryUrl)}
            aria-label={t('common.dismiss')}
          >
            <X className="size-3.5" />
          </Button>
        </>
      }
    />
  );
});
