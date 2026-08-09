import { Loader2, Milestone, Plus } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useFeature, useFeatures } from '@renderer/features/features/use-features';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { FeatureList } from './feature-list';
import { FeatureWorkspace } from './feature-workspace';

export function FeaturesPanel() {
  const { t } = useTranslation();
  const {
    params: { projectId, featureId },
    setParams,
  } = useParams('project');
  const features = useFeatures(projectId);
  const selectedId =
    featureId && features.data?.some((candidate) => candidate.id === featureId)
      ? featureId
      : features.data?.[0]?.id;
  const feature = useFeature(projectId, selectedId);
  const showCreate = useShowModal('createFeatureModal');

  useEffect(() => {
    if (featureId !== selectedId && selectedId) setParams({ featureId: selectedId });
  }, [featureId, selectedId, setParams]);

  const create = () =>
    showCreate({
      projectId,
      onSuccess: (created) => setParams({ featureId: created.id }),
    });

  if (features.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-4 animate-spin text-foreground-muted" />
      </div>
    );
  }

  if (features.isError) {
    return (
      <EmptyState
        label={t('featureDelivery.loadFailed')}
        description={features.error instanceof Error ? features.error.message : undefined}
      />
    );
  }

  if (!features.data || features.data.length === 0) {
    return (
      <EmptyState
        label={t('featureDelivery.emptyTitle')}
        description={t('featureDelivery.emptyDescription')}
        icon={<Milestone className="size-5" />}
        action={
          <Button onClick={create}>
            <Plus className="size-3.5" />
            {t('featureDelivery.newFeature')}
          </Button>
        }
      />
    );
  }

  return (
    <div className="@container flex h-full min-h-0 min-w-0 bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 @max-[760px]:flex-col">
        <FeatureList
          features={features.data}
          selectedId={selectedId}
          onSelect={(nextId) => setParams({ featureId: nextId })}
          onCreate={create}
        />
        {feature.isLoading ? (
          <div className="flex min-w-0 flex-1 items-center justify-center">
            <Loader2 className="size-4 animate-spin text-foreground-muted" />
          </div>
        ) : feature.data ? (
          <FeatureWorkspace projectId={projectId} feature={feature.data} />
        ) : (
          <EmptyState
            label={t('featureDelivery.notFound')}
            description={t('featureDelivery.notFoundDescription')}
          />
        )}
      </div>
    </div>
  );
}
