import { Bot, Plus, Settings2, TerminalSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuickAction } from '@shared/project-settings';
import { projectDisplayName } from '@shared/projects';
import { runProjectQuickAction } from '@renderer/features/projects/run-project-quick-action';
import {
  asMounted,
  getProjectSettingsStore,
  getProjectStore,
  getRepositoryStore,
} from '@renderer/features/projects/stores/project-selectors';
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
  const showCapture = useShowModal('captureProjectAutomationModal');

  const connectionId = project?.data?.type === 'ssh' ? project.data.connectionId : undefined;
  const { runtimeId } = useEffectiveRuntime(connectionId);

  const actions: QuickAction[] = settingsStore?.settings?.quickActions ?? [];

  const [runningId, setRunningId] = useState<string | null>(null);

  const handleCreate = () => {
    if (!project) return;
    showCapture({
      projectId,
      projectName: projectDisplayName(project.data),
    });
  };

  const handleRun = async (action: QuickAction) => {
    if (!project) return;
    setRunningId(action.id);
    try {
      if (action.kind === 'skill') {
        await Promise.all([repo?.localData.load(), repo?.remoteData.load()]);
      }
      const result = await runProjectQuickAction({
        project,
        action,
        runtimeId,
        defaultBranch: repo?.defaultBranch,
      });
      if (result.kind === 'skill') {
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
        <Button variant="outline" size="sm" onClick={handleCreate} disabled={!project}>
          <Plus className="size-3.5" />
          {t('sidebar.captureAutomation.createLabel')}
        </Button>
        {actions.length === 0 ? (
          <span className="self-center text-xs text-foreground-muted">
            {t('projects.quickActions.empty')}
          </span>
        ) : null}
        {actions.map((action) => (
          <Button
            key={action.id}
            variant="outline"
            size="sm"
            disabled={
              !project || runningId !== null || (action.kind === 'skill' ? !runtimeId : false)
            }
            onClick={() => void handleRun(action)}
          >
            {action.kind === 'command' ? (
              <TerminalSquare className="size-3.5" />
            ) : (
              <Bot className="size-3.5" />
            )}
            {runningId === action.id
              ? t('projects.quickActions.running', { label: action.label })
              : action.label}
          </Button>
        ))}
      </div>
    </section>
  );
});
