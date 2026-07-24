import { Play, Plus, Settings2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuickAction } from '@shared/project-settings';
import { openFeature } from '@renderer/features/features/feature-navigation';
import { runProjectQuickAction } from '@renderer/features/projects/run-project-quick-action';
import {
  asMounted,
  getProjectSettingsStore,
  getProjectStore,
  getRepositoryStore,
} from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useEffectiveRuntime } from '@renderer/features/tasks/conversations/use-effective-runtime';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { log } from '@renderer/utils/logger';

export const QuickActionsCard = observer(function QuickActionsCard({
  projectId,
}: {
  projectId: string;
}) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const project = asMounted(getProjectStore(projectId));
  const settingsStore = getProjectSettingsStore(projectId);
  const repo = getRepositoryStore(projectId);
  const showManage = useShowModal('manageQuickActionsModal');
  const showCreateFeature = useShowModal('createFeatureModal');

  const { value: homeDraft } = useAppSettingsKey('homeDraft');
  const connectionId = project?.data?.type === 'ssh' ? project.data.connectionId : undefined;
  const { runtimeId } = useEffectiveRuntime(connectionId);

  const projectActions = settingsStore?.settings?.quickActions;
  const globalDefaults = homeDraft?.defaultQuickActions ?? [];
  const actions: QuickAction[] = projectActions ?? globalDefaults;

  const [runningId, setRunningId] = useState<string | null>(null);

  const handleNewRequirement = () => {
    showCreateFeature({
      projectId,
      onSuccess: (feature) => openFeature(projectId, feature.id),
    });
  };

  const handleRun = async (action: QuickAction) => {
    if (!project) return;
    setRunningId(action.id);
    try {
      if (action.kind !== 'shell') {
        await Promise.all([repo?.localData.load(), repo?.remoteData.load()]);
      }
      const result = await runProjectQuickAction({
        project,
        action,
        runtimeId,
        defaultBranch: repo?.defaultBranch,
      });
      if (result.kind === 'agent') {
        navigate('task', { projectId, taskId: result.taskId });
      }
    } catch (err) {
      log.warn('runProjectQuickAction failed', { projectId, action, error: String(err) });
    } finally {
      setRunningId(null);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-background-elevated p-4">
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-foreground">{t('projects.quickActions.title')}</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => showManage({ projectId })}
          aria-label={t('projects.quickActions.manage')}
        >
          <Settings2 className="size-3.5" />
          {t('projects.quickActions.manage')}
        </Button>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={handleNewRequirement}>
          <Plus className="size-3.5" />
          {t('projects.quickActions.newRequirement')}
        </Button>
        {actions.map((action) => (
          <Button
            key={action.id}
            variant="outline"
            size="sm"
            disabled={
              !project ||
              runningId !== null ||
              (action.kind === 'shell' ? project.data.type !== 'local' : !runtimeId)
            }
            onClick={() => void handleRun(action)}
          >
            <Play className="size-3.5" />
            {runningId === action.id
              ? t('projects.quickActions.running', { label: action.label })
              : action.label}
          </Button>
        ))}
      </div>
    </section>
  );
});
