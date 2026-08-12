import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  aiLabAppCreatedChannel,
  aiLabAppUpdatedChannel,
  aiLabBuildFailedChannel,
} from '@shared/events/aiLabEvents';
import { aiLabQueryKeys } from '@renderer/features/ai-lab/use-ai-lab';
import { getProjectManagerStore } from '@renderer/features/projects/stores/project-selectors';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { events } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';

/** Connects background Yoda Build completion to Marketplace cache and user navigation. */
export function AiLabBuildEvents() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { navigate } = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    const offCreated = events.on(aiLabAppCreatedChannel, (payload) => {
      void queryClient.invalidateQueries({ queryKey: aiLabQueryKeys.apps });
      if (payload.appProject) {
        void getProjectManagerStore()
          .updateProjectAlias(payload.projectId, payload.appName)
          .catch(() => {});
      }
      toast({
        title: t('home.buildCreated', { name: payload.appName }),
        action: {
          label: t('aiLab.openApp'),
          onClick: () => navigate('library', { section: 'apps', appId: payload.appId }),
        },
      });
    });
    const offFailed = events.on(aiLabBuildFailedChannel, (payload) => {
      toast({
        title: t('home.buildFailed'),
        description: payload.message,
        variant: 'destructive',
        action: {
          label: t('aiLab.returnToBuildTask'),
          onClick: () =>
            navigate('task', {
              projectId: payload.projectId,
              taskId: payload.taskId,
              tab: { kind: 'conversation', conversationId: payload.conversationId },
            }),
        },
      });
    });
    const offUpdated = events.on(aiLabAppUpdatedChannel, (payload) => {
      void queryClient.invalidateQueries({ queryKey: aiLabQueryKeys.apps });
      if (payload.appProject && payload.projectId) {
        void getProjectManagerStore()
          .updateProjectAlias(payload.projectId, payload.appName)
          .catch(() => {});
      }
      toast({ title: t('home.buildUpdated', { name: payload.appName }) });
    });
    return () => {
      offCreated();
      offFailed();
      offUpdated();
    };
  }, [navigate, queryClient, t, toast]);

  return null;
}
