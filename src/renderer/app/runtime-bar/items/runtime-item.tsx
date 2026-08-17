import { useQuery, useQueryClient } from '@tanstack/react-query';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Conversation } from '@shared/conversations';
import type { RuntimeId } from '@shared/runtime-registry';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { AgentInfoCard } from '@renderer/lib/components/agent-selector/agent-info-card';
import type { SessionModelSettings } from '@renderer/lib/components/agent-selector/session-model-editor';
import { rpc } from '@renderer/lib/ipc';
import { appState } from '@renderer/lib/stores/app-state';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';
import { RUNTIME_BAR_METRIC_ACTION_CLASS } from '../bar-chrome';
import { useRuntimeBarMaas } from '../maas-context';
import { useRuntimeBarSession } from '../session-context';

/**
 * Who is answering: the session's runtime, the model it actually reports, and
 * the reasoning/speed it is running at. The popover is the full agent card, so
 * this is also where a session gets restarted onto a different model.
 */
export const RuntimeBarRuntimeItem = observer(function RuntimeBarRuntimeItem() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [isRuntimePopoverOpen, setIsRuntimePopoverOpen] = useState(false);
  const { runtimeId, runtime, runtimeConfig, provisionedTask, activeConversation, connectionId } =
    useRuntimeBarSession();
  const maas = useRuntimeBarMaas(runtimeId);
  const { data: sessionModelDetails } = useActiveSessionModelDetails({
    runtimeId,
    cwd: provisionedTask?.path,
    conversation: activeConversation,
    connectionId,
  });
  // This surface describes the active session, so provider-reported runtime
  // metadata is the only valid source. Requested overrides and global defaults
  // are configuration, not evidence of the model the session actually uses.
  const activeSessionModel = sessionModelDetails?.model ?? null;
  const displayedReasoningEffort = sessionModelDetails?.reasoningEffort ?? null;
  const displayedFastMode = sessionModelDetails?.fastMode ?? false;
  const dependency = runtimeId
    ? connectionId
      ? appState.dependencies.getRemote(connectionId).data?.[runtimeId]
      : appState.dependencies.agentStatuses[runtimeId]
    : undefined;

  if (!runtimeId) return null;

  const manageModels = () => {
    setIsRuntimePopoverOpen(false);
    appState.sidePane.pinView('settings', { tab: 'models' });
  };

  const restartCurrentSessionWithModel = async (settings: SessionModelSettings) => {
    if (!provisionedTask || !activeConversation || !runtime?.modelFlagOnResume) {
      throw new Error(t('workspaceRuntime.model.restartUnavailable'));
    }
    await provisionedTask.conversations.restartConversation(
      activeConversation.id,
      undefined,
      undefined,
      undefined,
      settings
    );
    await queryClient.invalidateQueries({
      queryKey: [
        'workspaceSessionModel',
        runtimeId ?? 'none',
        provisionedTask.path,
        activeConversation.id,
      ],
    });
  };

  return (
    <Popover open={isRuntimePopoverOpen} onOpenChange={setIsRuntimePopoverOpen}>
      <PopoverTrigger
        aria-label={t('workspaceRuntime.currentSessionTitle', {
          name: runtime?.name ?? runtimeId,
        })}
        className={cn(RUNTIME_BAR_METRIC_ACTION_CLASS, 'min-w-0 gap-1.5 text-foreground-muted')}
        title={t('workspaceRuntime.currentSessionTitle', {
          name: runtime?.name ?? runtimeId,
        })}
      >
        {runtimeConfig ? (
          <AgentLogo
            logo={runtimeConfig.logo}
            alt=""
            isSvg={runtimeConfig.isSvg}
            invertInDark={runtimeConfig.invertInDark}
            className="size-4 rounded-[2px]"
          />
        ) : null}
        <span className="truncate font-medium text-foreground @max-[720px]:hidden">
          {runtime?.name ?? runtimeId}
        </span>
        {activeSessionModel ? (
          <>
            <span aria-hidden className="text-foreground-passive @max-[720px]:hidden">
              ·
            </span>
            <span className="max-w-52 truncate font-mono text-[10px] text-foreground">
              {activeSessionModel}
            </span>
            {displayedReasoningEffort ? (
              <span className="max-w-16 truncate rounded-sm bg-background-2 px-1 font-mono text-[9px] text-foreground-passive @max-[960px]:hidden">
                {displayedReasoningEffort}
              </span>
            ) : null}
            {displayedFastMode ? (
              <span className="rounded-sm bg-violet-500/15 px-1 text-[9px] font-medium text-violet-700 @max-[960px]:hidden dark:text-violet-300">
                {t('workspaceRuntime.model.fastSpeed')}
              </span>
            ) : null}
          </>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-auto border-0 bg-transparent p-0 ring-0 shadow-none"
      >
        <AgentInfoCard
          id={runtimeId}
          dependency={dependency}
          selectedModel={activeSessionModel}
          selectedModelSource="currentSession"
          connectionId={connectionId}
          authPresentation={
            maas.activeForRuntime && maas.presentation.providerName
              ? {
                  value: maas.presentation.providerName,
                  detail: t('workspaceRuntime.maas.authenticationSource'),
                }
              : undefined
          }
          modelEditing={
            activeConversation && runtime?.modelFlagOnResume
              ? {
                  reasoningEffort: displayedReasoningEffort,
                  fastMode: displayedFastMode,
                  onRestartWithModel: restartCurrentSessionWithModel,
                  onManageModels: manageModels,
                  allowDefaultChange: !connectionId,
                }
              : undefined
          }
        />
      </PopoverContent>
    </Popover>
  );
});

type ActiveSessionModelDetails = {
  model: string | null;
  reasoningEffort: string | null;
  fastMode: boolean | null;
};

function useActiveSessionModelDetails({
  runtimeId,
  cwd,
  conversation,
  connectionId,
}: {
  runtimeId: RuntimeId | null;
  cwd?: string;
  conversation: Conversation | null;
  connectionId?: string;
}) {
  const supportedRuntime = !connectionId && (runtimeId === 'codex' || runtimeId === 'claude');
  return useQuery<ActiveSessionModelDetails | null>({
    queryKey: [
      'workspaceSessionModel',
      runtimeId ?? 'none',
      cwd ?? '',
      conversation?.id ?? '',
      conversation?.title ?? '',
      conversation?.createdAt ?? '',
      connectionId ?? 'local',
    ],
    queryFn: async () => {
      if (!runtimeId || !cwd || !conversation) return null;
      if (runtimeId === 'codex') {
        const metadata = await rpc.conversations.getCodexSessionRuntimeMetadata(
          cwd,
          conversation.id,
          conversation.title,
          conversation.createdAt ?? null
        );
        if (!metadata) return null;
        return {
          model: metadata.model,
          reasoningEffort: metadata.reasoningEffort,
          fastMode: isCodexFastServiceTier(metadata.serviceTier),
        };
      }
      if (runtimeId === 'claude') {
        const sessionId =
          conversation.sessionSource?.runtimeId === 'claude'
            ? conversation.sessionSource.sessionId
            : conversation.id;
        const metadata = await rpc.conversations.getClaudeSessionMetadata(cwd, sessionId);
        return metadata ? { model: metadata.model, reasoningEffort: null, fastMode: null } : null;
      }
      return null;
    },
    enabled: Boolean(supportedRuntime && cwd && conversation),
    staleTime: 3_000,
    refetchInterval: supportedRuntime && cwd && conversation ? 5_000 : false,
    refetchOnWindowFocus: true,
  });
}

function isCodexFastServiceTier(serviceTier: string | null | undefined): boolean {
  return serviceTier === 'fast' || serviceTier === 'priority';
}
