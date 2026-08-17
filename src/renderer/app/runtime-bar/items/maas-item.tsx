import { Cloud } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  WORKSPACE_BAR_ACTION_DOT_CLASS,
  WORKSPACE_BAR_ACTION_INLINE_DOT_CLASS,
  WorkspaceBarActionGlyph,
} from '@renderer/app/workspace-bar-action-indicator';
import { WORKSPACE_BAR_CARD_CLASS } from '@renderer/app/workspace-bar-card';
import { WorkspaceMaasPopover } from '@renderer/app/workspace-maas-popover';
import { usePopoverDismiss } from '@renderer/lib/hooks/use-popover-dismiss';
import { rpc } from '@renderer/lib/ipc';
import { appState } from '@renderer/lib/stores/app-state';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';
import { RUNTIME_BAR_ACTION_CLASS, RUNTIME_BAR_ACTION_LABEL_CLASS } from '../bar-chrome';
import { useRuntimeBarMaas } from '../maas-context';
import { useRuntimeBarSession } from '../session-context';

/**
 * Where model calls are routed: the runtime's own account, or a bound
 * model-access Profile. The dot carries the state at a glance — bound and in
 * effect, bound but inert, or off.
 */
export const RuntimeBarMaasItem = observer(function RuntimeBarMaasItem() {
  const { t } = useTranslation();
  const [isMaasPopoverOpen, setIsMaasPopoverOpen] = useState(false);
  const { actionsRef: maasActionsRef, dismissThen: dismissMaasPopoverThen } = usePopoverDismiss(
    isMaasPopoverOpen,
    setIsMaasPopoverOpen
  );
  const { runtimeId } = useRuntimeBarSession();
  const maas = useRuntimeBarMaas(runtimeId);
  const maasPresentation = maas.presentation;
  const maasDotToneClass = maas.dotToneClass;
  const maasTriggerLabel = maasPresentation.providerName
    ? t('workspaceRuntime.maas.labelWithProvider', {
        provider: maasPresentation.providerName,
      })
    : t('workspaceRuntime.maas.title');

  // Both destinations are full settings surfaces, so the popover closes on the
  // way out rather than lingering behind the pane it just opened.
  const openMaasManagement = useCallback(() => {
    dismissMaasPopoverThen(maas.openManagement);
  }, [dismissMaasPopoverThen, maas.openManagement]);
  const openMaasLogs = useCallback(() => {
    dismissMaasPopoverThen(() => {
      appState.sidePane.pinView('settings', { tab: 'ai-logs' });
    });
  }, [dismissMaasPopoverThen]);
  // Leaves for the browser rather than another pane behind the popover, so this
  // one dismisses too — coming back to a popover left open reads as a stray.
  const websiteUrl = maasPresentation.websiteUrl;
  const openMaasWebsite = useCallback(() => {
    if (!websiteUrl) return;
    dismissMaasPopoverThen(() => void rpc.app.openExternal(websiteUrl));
  }, [dismissMaasPopoverThen, websiteUrl]);

  return (
    <Popover
      open={isMaasPopoverOpen}
      onOpenChange={setIsMaasPopoverOpen}
      actionsRef={maasActionsRef}
    >
      <PopoverTrigger
        aria-label={maasTriggerLabel}
        className={cn(
          RUNTIME_BAR_ACTION_CLASS,
          isMaasPopoverOpen
            ? 'bg-background-2 text-foreground'
            : maasPresentation.active
              ? 'text-foreground'
              : 'text-foreground-passive'
        )}
        title={maasTriggerLabel}
      >
        <WorkspaceBarActionGlyph icon={Cloud}>
          <span aria-hidden className={cn(WORKSPACE_BAR_ACTION_DOT_CLASS, maasDotToneClass)} />
        </WorkspaceBarActionGlyph>
        {maasPresentation.providerName ? (
          <span className="inline-block max-w-40 truncate @max-[1440px]:hidden">
            {t('workspaceRuntime.maas.providerSuffix', {
              provider: maasPresentation.providerName,
            })}
          </span>
        ) : (
          <span className={RUNTIME_BAR_ACTION_LABEL_CLASS}>{t('workspaceRuntime.maas.title')}</span>
        )}
        <span aria-hidden className={cn(WORKSPACE_BAR_ACTION_INLINE_DOT_CLASS, maasDotToneClass)} />
      </PopoverTrigger>
      {isMaasPopoverOpen ? (
        <PopoverContent
          align="end"
          side="top"
          sideOffset={8}
          className={cn(WORKSPACE_BAR_CARD_CLASS, 'w-[21rem]')}
        >
          <WorkspaceMaasPopover
            binding={maas.binding}
            providerName={maasPresentation.providerName}
            websiteUrl={websiteUrl}
            onManage={openMaasManagement}
            onOpenWebsite={openMaasWebsite}
            onOpenLogs={openMaasLogs}
          />
        </PopoverContent>
      ) : null}
    </Popover>
  );
});
