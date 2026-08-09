import { Check, Circle, LockKeyhole } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { featureStageIds, type FeatureStageId } from '@shared/features';
import { cn } from '@renderer/utils/utils';

export function FeatureStageRail({ stage }: { stage: FeatureStageId }) {
  const { t } = useTranslation();
  const currentIndex = featureStageIds.indexOf(stage);

  return (
    <nav
      className="flex w-full shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-background-secondary px-3 py-2 @min-[980px]:w-40 @min-[980px]:items-stretch @min-[980px]:flex-col @min-[980px]:gap-0.5 @min-[980px]:overflow-y-auto @min-[980px]:border-r @min-[980px]:border-b-0 @min-[980px]:px-2 @min-[980px]:py-3"
      aria-label={t('featureDelivery.stagesLabel')}
    >
      {featureStageIds.map((stageId, index) => {
        const isCurrent = stageId === stage;
        const isComplete = index < currentIndex;
        return (
          <div
            key={stageId}
            className={cn(
              'relative flex min-w-28 shrink-0 items-center gap-2 rounded-md px-2 py-2 text-xs text-foreground-muted @min-[980px]:min-w-0',
              isCurrent && 'bg-background-2 text-foreground shadow-xs'
            )}
            aria-current={isCurrent ? 'step' : undefined}
          >
            <span
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background font-mono text-[9px] text-foreground-passive',
                isCurrent && 'border-primary text-primary',
                isComplete && 'border-status-done/50 bg-status-done/10 text-status-done'
              )}
            >
              {isComplete ? (
                <Check className="size-3" />
              ) : isCurrent ? (
                <Circle className="size-2.5 fill-current" />
              ) : (
                <LockKeyhole className="size-2.5" />
              )}
            </span>
            <span className="min-w-0 truncate">
              <span className="mr-1.5 font-mono text-[9px] text-foreground-passive">
                {String(index + 1).padStart(2, '0')}
              </span>
              {t(`featureDelivery.stages.${stageId}.short`)}
            </span>
          </div>
        );
      })}
    </nav>
  );
}
