import {
  BookOpenText,
  Check,
  CircleAlert,
  Code2,
  FileSearch,
  Megaphone,
  PenTool,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  deriveFeatureWorkflowProgress,
  FEATURE_WORKFLOW_STAGES,
  type FeatureWorkflowStageId,
  type FeatureWorkflowStageProgress,
  type FeatureWorkflowStageStatus,
} from '@shared/feature-workflow';
import type { RoomSnapshot } from '@shared/team-room';
import { cn } from '@renderer/utils/utils';

const STAGE_ICONS: Record<FeatureWorkflowStageId, LucideIcon> = {
  problem: FileSearch,
  'product-design': PenTool,
  implementation: Code2,
  validation: Check,
  'feature-docs': BookOpenText,
  'launch-docs': Megaphone,
};

const STATUS_STYLES: Record<FeatureWorkflowStageStatus, string> = {
  pending: 'border-border/60 bg-background text-foreground-passive',
  active: 'border-primary/45 bg-primary/5 text-primary ring-1 ring-primary/15',
  completed: 'border-primary/25 bg-background-1 text-foreground',
  blocked: 'border-destructive/45 bg-destructive/5 text-destructive',
};

function stageTitleKey(stageId: FeatureWorkflowStageId): string {
  return `featureWorkflow.stages.${stageId}.title`;
}

function stageDeliverableKey(stageId: FeatureWorkflowStageId): string {
  return `featureWorkflow.stages.${stageId}.deliverable`;
}

export function FeatureWorkflowPreview({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <ol
      className={cn('grid grid-cols-2 gap-px overflow-hidden border border-border/60', className)}
    >
      {FEATURE_WORKFLOW_STAGES.map((stage) => (
        <li key={stage.id} className="min-w-0 bg-background-1/50 px-2.5 py-2">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[10px] font-semibold text-primary/70">
              {stage.number}
            </span>
            <span className="truncate text-xs font-medium text-foreground">
              {t(stageTitleKey(stage.id))}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-foreground-muted">
            {t(stageDeliverableKey(stage.id))}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function FeatureWorkflowRail({
  snapshot,
  onOpenMember,
}: {
  snapshot: RoomSnapshot;
  onOpenMember: (memberId: string) => void;
}) {
  const { t } = useTranslation();
  const progress = deriveFeatureWorkflowProgress(snapshot.members, snapshot.messages);
  const completedCount = progress.filter((stage) => stage.status === 'completed').length;
  const focus =
    progress.find((stage) => stage.status === 'blocked') ??
    progress.find((stage) => stage.status === 'active') ??
    progress.at(-1);

  return (
    <section
      aria-labelledby="feature-workflow-title"
      className="shrink-0 border-b border-border bg-background-1/35 px-5 py-3"
    >
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id="feature-workflow-title" className="text-xs font-semibold text-foreground">
          {t('featureWorkflow.title')}
        </h3>
        <p className="text-[11px] text-foreground-muted">{t('featureWorkflow.subtitle')}</p>
        <span className="ml-auto font-mono text-[10px] font-medium text-foreground-muted">
          {t('featureWorkflow.progress', {
            completed: completedCount,
            total: FEATURE_WORKFLOW_STAGES.length,
          })}
        </span>
        {focus && (
          <span className="sr-only" aria-live="polite" aria-atomic="true">
            {`${t(stageTitleKey(focus.stage.id))}: ${t(
              `featureWorkflow.status.${focus.status}`
            )}. ${focus.detail || t(stageDeliverableKey(focus.stage.id))}`}
          </span>
        )}
      </div>

      <ol className="grid grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-6">
        {progress.map((item, index) => (
          <FeatureStageItem
            key={item.stage.id}
            item={item}
            isLast={index === progress.length - 1}
            onOpenMember={onOpenMember}
          />
        ))}
      </ol>

      {focus && (
        <div className="mt-2 flex min-w-0 items-start gap-2 text-[11px] leading-4">
          {focus.status === 'blocked' && (
            <CircleAlert className="mt-0.5 size-3 shrink-0 text-destructive" />
          )}
          <span className="shrink-0 font-medium text-foreground-muted">
            {t(
              focus.detail ? 'featureWorkflow.latestEvidence' : 'featureWorkflow.currentDeliverable'
            )}
          </span>
          <span
            className={cn(
              'line-clamp-2 min-w-0 break-words',
              focus.status === 'blocked' ? 'text-destructive' : 'text-foreground-muted'
            )}
          >
            {focus.detail || t(stageDeliverableKey(focus.stage.id))}
          </span>
        </div>
      )}
    </section>
  );
}

function FeatureStageItem({
  item,
  isLast,
  onOpenMember,
}: {
  item: FeatureWorkflowStageProgress;
  isLast: boolean;
  onOpenMember: (memberId: string) => void;
}) {
  const { t } = useTranslation();
  const Icon = STAGE_ICONS[item.stage.id];
  const completed = item.status === 'completed';
  const blocked = item.status === 'blocked';

  return (
    <li className="relative min-w-0">
      {!isLast && (
        <span
          aria-hidden
          className={cn(
            'absolute left-[calc(50%+1rem)] right-[calc(-50%+1rem)] top-4 hidden border-t 2xl:block',
            completed ? 'border-primary/40' : 'border-border/70'
          )}
        />
      )}
      <button
        type="button"
        disabled={!item.member}
        onClick={() => item.member && onOpenMember(item.member.id)}
        aria-current={item.status === 'active' ? 'step' : undefined}
        aria-label={`${item.stage.number} ${t(stageTitleKey(item.stage.id))}: ${t(
          `featureWorkflow.status.${item.status}`
        )}`}
        title={item.detail || t(stageDeliverableKey(item.stage.id))}
        className={cn(
          'relative flex w-full min-w-0 items-center gap-2 border-l-2 px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default',
          STATUS_STYLES[item.status]
        )}
      >
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center border bg-background font-mono text-[9px] font-semibold',
            item.status === 'active' && 'border-primary/45 text-primary',
            completed && 'border-primary/30 bg-primary/10 text-primary',
            blocked && 'border-destructive/40 bg-destructive/10 text-destructive',
            item.status === 'pending' && 'border-border/70 text-foreground-passive'
          )}
        >
          {completed ? (
            <Check className="size-3.5" />
          ) : blocked ? (
            <CircleAlert className="size-3.5" />
          ) : (
            <Icon className="size-3.5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="font-mono text-[9px] opacity-65">{item.stage.number}</span>
            <span className="truncate text-[11px] font-medium">
              {t(stageTitleKey(item.stage.id))}
            </span>
          </span>
          <span className="block truncate text-[9px] opacity-70">
            {t(`featureWorkflow.status.${item.status}`)}
          </span>
        </span>
      </button>
    </li>
  );
}
