import { useCallback, useMemo } from 'react';
import type { RuntimeId } from '@shared/runtime-registry';
import { useMaasConnections, useMaasGlobalBinding } from '@renderer/features/maas/useMaas';
import { appState } from '@renderer/lib/stores/app-state';
import { getWorkspaceMaasPresentation } from '../workspace-runtime-bar-maas';
import { isMaasUsageActiveForRuntime } from '../workspace-runtime-usage-source';

/**
 * The global model-access binding as the bar reads it. The routing entry and the
 * usage entry describe the same binding from two angles, so they resolve it the
 * same way here rather than each deriving its own presentation.
 */
export function useRuntimeBarMaas(runtimeId: RuntimeId | null) {
  const binding = useMaasGlobalBinding();
  const { data: connections } = useMaasConnections();
  const presentation = useMemo(
    () => getWorkspaceMaasPresentation(binding.data, connections),
    [binding.data, connections]
  );
  const activeForRuntime = isMaasUsageActiveForRuntime(runtimeId, binding.data);
  /**
   * Model access is configured in one place only — the Settings pane. Carrying
   * the bound Profile in expands it there, so no entry needs a second
   * per-Profile entry point. It navigates rather than pins: the pane is a full
   * configuration surface, not a reference panel to keep open beside the work.
   */
  const boundPlatformId = binding.data?.platformId;
  const openManagement = useCallback(() => {
    appState.navigation.navigate('settings', {
      tab: 'maas',
      maasPlatformId: boundPlatformId ?? undefined,
    });
  }, [boundPlatformId]);

  return {
    binding: binding.data,
    presentation,
    activeForRuntime,
    activePlatformId: activeForRuntime ? binding.data?.platformId : undefined,
    openManagement,
    dotToneClass: binding.data?.effective
      ? 'bg-emerald-500'
      : binding.data?.enabled
        ? 'bg-amber-500'
        : 'bg-foreground-disabled',
  };
}
