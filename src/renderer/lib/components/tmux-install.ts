import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getAgentInstallErrorMessage } from '@renderer/lib/components/agent-selector/agent-install';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { appState } from '@renderer/lib/stores/app-state';

export function useInstallTmux() {
  const { t } = useTranslation();
  const { toast } = useToast();

  return useCallback(
    async (connectionId?: string) => {
      if (appState.dependencies.isInstalling('tmux', connectionId)) {
        return;
      }

      const result = await appState.dependencies.install('tmux', connectionId);
      if (result.success) {
        toast({
          title: t('settings.tasks.tmuxInstalled'),
          description: t('settings.tasks.tmuxInstalledDescription'),
        });
        return;
      }

      const description =
        result.error.type === 'not-detected-after-install'
          ? t('settings.tasks.tmuxNotDetectedAfterInstall')
          : result.error.type === 'no-install-command'
            ? t('settings.tasks.tmuxNoInstallCommand')
            : getAgentInstallErrorMessage(result.error);

      toast({
        title: t('settings.tasks.tmuxInstallFailed'),
        description,
        variant: 'destructive',
      });
    },
    [t, toast]
  );
}
