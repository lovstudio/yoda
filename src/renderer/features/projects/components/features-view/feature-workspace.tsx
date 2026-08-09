import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Clock3,
  MoreHorizontal,
  Save,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getPreviousFeatureStage,
  type Feature,
  type FeatureGateBlocker,
  type FeatureStatus,
} from '@shared/features';
import { useFeatureMutations } from '@renderer/features/features/use-features';
import { rpc } from '@renderer/lib/ipc';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Input } from '@renderer/lib/ui/input';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import { FeatureArtifacts } from './feature-artifacts';
import { FeatureStageRail } from './feature-stage-rail';
import { FeatureTasks } from './feature-tasks';

function GateBlockerRow({ blocker }: { blocker: FeatureGateBlocker }) {
  const { t } = useTranslation();
  let message: string;
  switch (blocker.code) {
    case 'feature_not_active':
      message = t('featureDelivery.gate.blockers.featureNotActive', {
        status: t(`featureDelivery.statuses.${blocker.status}`),
      });
      break;
    case 'problem_required':
      message = t('featureDelivery.gate.blockers.problemRequired');
      break;
    case 'artifact_missing':
      message = t('featureDelivery.gate.blockers.artifactMissing', {
        artifact: t(`featureDelivery.artifactTypes.${blocker.artifactType}`),
      });
      break;
    case 'artifact_unapproved':
      message = t('featureDelivery.gate.blockers.artifactUnapproved', {
        artifact: t(`featureDelivery.artifactTypes.${blocker.artifactType}`),
      });
      break;
    case 'artifact_stale':
      message = t('featureDelivery.gate.blockers.artifactStale', {
        artifact: t(`featureDelivery.artifactTypes.${blocker.artifactType}`),
      });
      break;
    case 'task_required':
      message = t('featureDelivery.gate.blockers.taskRequired');
      break;
    case 'task_incomplete':
      message = t('featureDelivery.gate.blockers.taskIncomplete', {
        count: blocker.taskIds.length,
      });
      break;
  }

  return (
    <li className="flex items-start gap-2 text-xs leading-5 text-foreground-muted">
      <AlertTriangle className="mt-1 size-3 shrink-0 text-amber-500" />
      <span>{message}</span>
    </li>
  );
}

function FeatureGate({
  feature,
  mutations,
}: {
  feature: Feature;
  mutations: ReturnType<typeof useFeatureMutations>;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const previousStage = getPreviousFeatureStage(feature.stage);

  const advance = async () => {
    setError(null);
    try {
      const result = await mutations.advance.mutateAsync();
      if (!result.success) setError(t('featureDelivery.gate.transitionFailed'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('featureDelivery.gate.transitionFailed'));
    }
  };
  const retreat = async () => {
    setError(null);
    try {
      const result = await mutations.retreat.mutateAsync();
      if (!result.success) setError(t('featureDelivery.gate.transitionFailed'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('featureDelivery.gate.transitionFailed'));
    }
  };

  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-border bg-background-secondary p-4 @max-[1180px]:w-64 @max-[980px]:w-full @max-[980px]:border-t @max-[980px]:border-l-0">
      <div className="mb-5 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-medium text-foreground">{t('featureDelivery.gate.title')}</h3>
          <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-foreground-passive">
            {feature.gate.nextStage
              ? t('featureDelivery.gate.target', {
                  stage: t(`featureDelivery.stages.${feature.gate.nextStage}.short`),
                })
              : t('featureDelivery.gate.complete')}
          </p>
        </div>
        <span
          className={cn(
            'flex size-8 items-center justify-center rounded-full border',
            feature.gate.canAdvance
              ? 'border-status-done/30 bg-status-done/10 text-status-done'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
          )}
        >
          {feature.gate.canAdvance ? (
            <CheckCircle2 className="size-4" />
          ) : (
            <AlertTriangle className="size-4" />
          )}
        </span>
      </div>

      {feature.gate.nextStage === null ? (
        <div className="rounded-md border border-status-done/30 bg-status-done/10 p-3 text-xs leading-5 text-status-done">
          {t('featureDelivery.gate.completedDescription')}
        </div>
      ) : feature.gate.canAdvance ? (
        <div className="rounded-md border border-status-done/30 bg-status-done/10 p-3">
          <p className="text-xs font-medium text-status-done">{t('featureDelivery.gate.ready')}</p>
          <p className="mt-1 text-xs leading-5 text-foreground-muted">
            {t('featureDelivery.gate.readyDescription')}
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-amber-500/25 bg-amber-500/5 p-3">
          <p className="mb-2 text-xs font-medium text-amber-700 dark:text-amber-300">
            {t('featureDelivery.gate.blocked', { count: feature.gate.blockers.length })}
          </p>
          <ul className="space-y-1.5">
            {feature.gate.blockers.map((blocker, index) => (
              <GateBlockerRow key={`${blocker.code}-${index}`} blocker={blocker} />
            ))}
          </ul>
        </div>
      )}

      {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
      <div className="mt-4 grid gap-2">
        {feature.gate.nextStage ? (
          <Button
            className="w-full"
            disabled={!feature.gate.canAdvance || mutations.advance.isPending}
            onClick={() => void advance()}
          >
            {t('featureDelivery.gate.advance', {
              stage: t(`featureDelivery.stages.${feature.gate.nextStage}.short`),
            })}
            <ArrowRight className="size-3.5" />
          </Button>
        ) : null}
        <Button
          variant="outline"
          className="w-full"
          disabled={!previousStage || mutations.retreat.isPending}
          onClick={() => void retreat()}
        >
          <ArrowLeft className="size-3.5" />
          {previousStage
            ? t('featureDelivery.gate.retreat', {
                stage: t(`featureDelivery.stages.${previousStage}.short`),
              })
            : t('featureDelivery.gate.firstStage')}
        </Button>
      </div>
    </aside>
  );
}

function FeatureBrief({
  feature,
  mutations,
}: {
  feature: Feature;
  mutations: ReturnType<typeof useFeatureMutations>;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(feature.title);
  const [problem, setProblem] = useState(feature.problem);
  const [outcome, setOutcome] = useState(feature.outcome);
  const [nonGoals, setNonGoals] = useState(feature.nonGoals);

  const dirty =
    title !== feature.title ||
    problem !== feature.problem ||
    outcome !== feature.outcome ||
    nonGoals !== feature.nonGoals;
  const canSave = dirty && title.trim().length > 0 && problem.trim().length > 0;

  return (
    <section>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-foreground-passive">
            {t('featureDelivery.briefLabel')}
          </p>
          <h2 className="mt-1 text-sm font-medium text-foreground">
            {t(`featureDelivery.stages.${feature.stage}.label`)}
          </h2>
          <p className="mt-1 max-w-xl text-xs leading-5 text-foreground-muted">
            {t(`featureDelivery.stages.${feature.stage}.description`)}
          </p>
        </div>
        <Button
          variant={dirty ? 'default' : 'outline'}
          size="sm"
          disabled={!canSave || mutations.update.isPending}
          onClick={() => mutations.update.mutate({ title, problem, outcome, nonGoals })}
        >
          <Save className="size-3.5" />
          {t('featureDelivery.fields.save')}
        </Button>
      </div>
      <div className="grid gap-3">
        <label className="grid gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-foreground-passive">
            {t('featureDelivery.fields.title')}
          </span>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="grid gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-foreground-passive">
            {t('featureDelivery.fields.problem')}
          </span>
          <Textarea value={problem} rows={4} onChange={(event) => setProblem(event.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3 @max-[720px]:grid-cols-1">
          <label className="grid gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-foreground-passive">
              {t('featureDelivery.fields.outcome')}
            </span>
            <Textarea
              value={outcome}
              rows={3}
              onChange={(event) => setOutcome(event.target.value)}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-foreground-passive">
              {t('featureDelivery.fields.nonGoals')}
            </span>
            <Textarea
              value={nonGoals}
              rows={3}
              onChange={(event) => setNonGoals(event.target.value)}
            />
          </label>
        </div>
      </div>
      {mutations.update.isError ? (
        <p className="mt-2 text-xs text-destructive">{t('featureDelivery.saveFailed')}</p>
      ) : null}
    </section>
  );
}

export function FeatureWorkspace({ projectId, feature }: { projectId: string; feature: Feature }) {
  const { t } = useTranslation();
  const mutations = useFeatureMutations(projectId, feature.id);
  const setStatus = (status: Exclude<FeatureStatus, 'completed'>) =>
    mutations.update.mutate({ status });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                'size-2 shrink-0 rounded-full bg-status-in-progress',
                feature.status === 'blocked' && 'bg-amber-500',
                feature.status === 'completed' && 'bg-status-done',
                feature.status === 'cancelled' && 'bg-foreground-passive'
              )}
            />
            <h1 className="truncate text-sm font-medium text-foreground">{feature.title}</h1>
            <Badge variant="outline">{t(`featureDelivery.statuses.${feature.status}`)}</Badge>
          </div>
          {feature.sourceIssues.length > 0 ? (
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-foreground-passive">
              <CircleDot className="size-3" />
              {feature.sourceIssues.map((issue) => (
                <button
                  key={issue.url}
                  type="button"
                  className="truncate font-mono hover:text-foreground hover:underline"
                  onClick={() => void rpc.app.openExternal(issue.url)}
                >
                  {issue.identifier}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('common.more')}
                disabled={feature.status === 'completed'}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-44">
            {(['active', 'blocked', 'cancelled'] as const).map((status) => (
              <DropdownMenuItem
                key={status}
                disabled={feature.status === status}
                onClick={() => setStatus(status)}
              >
                {t(`featureDelivery.statuses.${status}`)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <div className="@container min-h-0 min-w-0 flex-1">
        <div className="flex h-full min-h-0 min-w-0 @max-[980px]:flex-col">
          <FeatureStageRail stage={feature.stage} />
          <main className="min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto grid w-full max-w-3xl gap-5 px-6 py-6 @max-[720px]:px-4">
              <FeatureBrief
                key={[
                  feature.id,
                  feature.title,
                  feature.problem,
                  feature.outcome,
                  feature.nonGoals,
                ].join('\0')}
                feature={feature}
                mutations={mutations}
              />
              <FeatureTasks projectId={projectId} feature={feature} mutations={mutations} />
              <FeatureArtifacts projectId={projectId} feature={feature} mutations={mutations} />
              <section className="border-t border-border pt-4">
                <h3 className="mb-2 inline-flex items-center gap-2 text-xs font-medium text-foreground">
                  <Clock3 className="size-3.5" />
                  {t('featureDelivery.events.title')}
                </h3>
                <ol className="grid gap-2">
                  {feature.events.slice(0, 8).map((event) => (
                    <li
                      key={event.id}
                      className="grid grid-cols-[8px_minmax(0,1fr)_auto] items-center gap-2 text-xs"
                    >
                      <span className="size-1.5 rounded-full bg-foreground-passive" />
                      <span className="truncate text-foreground-muted">
                        {t(`featureDelivery.events.types.${event.type}`)}
                      </span>
                      <RelativeTime
                        value={event.createdAt}
                        compact
                        className="text-[10px] text-foreground-passive"
                      />
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          </main>
          <FeatureGate feature={feature} mutations={mutations} />
        </div>
      </div>
    </div>
  );
}
