import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { tmuxUnavailableChannel } from '@shared/events/appEvents';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { events } from '@renderer/lib/ipc';
import { useInstallTmux } from './tmux-install';

export function TmuxUnavailableNotifier() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const installTmux = useInstallTmux();
  const shownKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    return events.on(tmuxUnavailableChannel, (event) => {
      const targetKey = event.connectionId ?? 'local';
      if (shownKeysRef.current.has(targetKey)) {
        return;
      }
      shownKeysRef.current.add(targetKey);

      toast({
        title: t('settings.tasks.tmuxUnavailableTitle'),
        description: event.connectionId
          ? t('settings.tasks.tmuxUnavailableRemoteDescription')
          : t('settings.tasks.tmuxUnavailableDescription'),
        action: {
          label: t('settings.tasks.installTmux'),
          onClick: () => {
            void installTmux(event.connectionId);
          },
        },
      });
    });
  }, [installTmux, t, toast]);

  return null;
}
