import { RefreshCw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { log } from '@renderer/utils/logger';

/**
 * Re-runs detection for all CLI runtimes. Surfaced as the "Runtimes" section
 * header action so a user who just installed a tool — or whose PATH wasn't ready
 * at boot — can refresh without restarting the app. The roster itself now lives
 * in {@link ../../agents/components/RuntimeAccordion}.
 */
export const CliAgentsRescanButton: React.FC = observer(() => {
  const { t } = useTranslation();
  const [rescanning, setRescanning] = useState(false);

  const handleRescan = useCallback(async () => {
    if (rescanning) return;
    setRescanning(true);
    try {
      await appState.dependencies.probeAll();
    } catch (error) {
      log.error('Failed to rescan CLI agents:', error);
    } finally {
      setRescanning(false);
    }
  }, [rescanning]);

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => void handleRescan()}
      disabled={rescanning}
      className="gap-1.5"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${rescanning ? 'animate-spin' : ''}`} />
      {t('settings.agentsTab.rescan')}
    </Button>
  );
});
