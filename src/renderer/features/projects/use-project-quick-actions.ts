import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuickAction } from '@shared/project-settings';
import {
  getRunningProjectQuickActionTarget,
  openProjectQuickActionTarget,
} from '@renderer/features/projects/project-quick-action-target';
import type { ProjectQuickActionsMenuActions } from '@renderer/features/projects/project-quick-actions-menu';
import { runProjectQuickAction } from '@renderer/features/projects/run-project-quick-action';
import {
  asMounted,
  getProjectSettingsStore,
  getProjectStore,
  getRepositoryStore,
} from '@renderer/features/projects/stores/project-selectors';
import { useEffectiveRuntime } from '@renderer/features/tasks/conversations/use-effective-runtime';
import { toast } from '@renderer/lib/hooks/use-toast';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { log } from '@renderer/utils/logger';

/**
 * Shared project-scoped quick-action wiring. A quick action belongs to the
 * project rather than the surface that exposes it, so project and task menus
 * execute and resume the same action through this one boundary.
 */
export function useProjectQuickActions(projectId: string): ProjectQuickActionsMenuActions {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const showCaptureAutomation = useShowModal('captureProjectAutomationModal');
  const showManageQuickActions = useShowModal('manageQuickActionsModal');

  const projectStore = getProjectStore(projectId);
  const project = asMounted(projectStore);
  const settingsStore = getProjectSettingsStore(projectId);
  const quickActions = settingsStore?.settings?.quickActions ?? [];
  const connectionId = project?.data.type === 'ssh' ? project.data.connectionId : undefined;
  const { runtimeId } = useEffectiveRuntime(connectionId);
  const quickActionTargets = new Map(
    project
      ? quickActions.flatMap((action) => {
          const target = getRunningProjectQuickActionTarget(project, action);
          return target ? [[action.id, target] as const] : [];
        })
      : []
  );

  const handleRunQuickAction = useCallback(
    async (action: QuickAction) => {
      const mountedProject = asMounted(getProjectStore(projectId));
      const latestRepository = getRepositoryStore(projectId);
      if (!mountedProject) return;

      try {
        if (action.kind === 'skill') {
          if (!latestRepository) return;
          await Promise.all([
            latestRepository.localData.load(),
            latestRepository.remoteData.load(),
          ]);
        }
        const result = await runProjectQuickAction({
          project: mountedProject,
          action,
          runtimeId,
          defaultBranch: latestRepository?.defaultBranch,
        });
        if (result.kind === 'skill') {
          navigate('task', { projectId, taskId: result.taskId });
        }
      } catch (error) {
        log.warn('project quick action failed', {
          projectId,
          actionId: action.id,
          error: String(error),
        });
        toast({
          title: t('sidebar.captureAutomation.runFailed'),
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        });
      }
    },
    [navigate, projectId, runtimeId, t]
  );

  const handleNavigateQuickAction = useCallback(
    (action: QuickAction) => {
      void (async () => {
        const mountedProject = asMounted(getProjectStore(projectId));
        if (!mountedProject) return;
        const target = getRunningProjectQuickActionTarget(mountedProject, action);
        if (
          target &&
          (await openProjectQuickActionTarget(mountedProject, target, (taskId) => {
            navigate('task', { projectId, taskId });
          }))
        ) {
          return;
        }
        await handleRunQuickAction(action);
      })().catch((error) => {
        log.warn('project quick action navigation failed', {
          projectId,
          actionId: action.id,
          error: String(error),
        });
        toast({
          title: t('sidebar.captureAutomation.runFailed'),
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        });
      });
    },
    [handleRunQuickAction, navigate, projectId, t]
  );

  const canUseQuickActions = Boolean(projectStore && projectStore.state !== 'unregistered');
  return {
    onQuickActionsMenuOpen: () => {
      void settingsStore?.pageData.load();
    },
    onCaptureAutomation: canUseQuickActions
      ? () => showCaptureAutomation({ projectId, projectName: projectStore.displayName })
      : undefined,
    onManageQuickActions: canUseQuickActions
      ? () => showManageQuickActions({ projectId })
      : undefined,
    quickActions,
    isQuickActionRunning: (action: QuickAction) => quickActionTargets.has(action.id),
    canRunQuickAction: (action: QuickAction) => action.kind === 'command' || Boolean(runtimeId),
    onRunQuickAction:
      projectStore?.state === 'mounted' &&
      (runtimeId || quickActions.some((action) => action.kind === 'command'))
        ? (action: QuickAction) => void handleRunQuickAction(action)
        : undefined,
    onNavigateQuickAction:
      projectStore?.state === 'mounted'
        ? (action: QuickAction) => handleNavigateQuickAction(action)
        : undefined,
  };
}
