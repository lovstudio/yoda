import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Gauge } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getRuntimeAccountProfile,
  type AgentAccountProviderId,
  type AgentAccountUsage,
} from '@shared/runtime-registry';
import { YODA_ACCOUNT_USAGE_DOC_URL } from '@shared/urls';
import {
  WORKSPACE_BAR_CARD_CLASS,
  WorkspaceBarCardFooter,
  WorkspaceBarCardHeader,
  WorkspaceBarCardMenu,
  WorkspaceBarCardRow,
  WorkspaceBarCardSection,
} from '@renderer/app/workspace-bar-card';
import {
  getAccountUsageThresholdAlert,
  getNextAccountResetCredit,
  getQuotaWindowLabel,
} from '@renderer/app/workspace-runtime-bar-format';
import { shouldReadOfficialAccountUsage } from '@renderer/app/workspace-runtime-usage-source';
import { accountProviderLabelKey } from '@renderer/features/agents/account-provider-label';
import { useMaasUsageSummary } from '@renderer/features/maas/useMaas';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { copyTextToClipboard, useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { DropdownMenuItem } from '@renderer/lib/ui/dropdown-menu';
import { Input } from '@renderer/lib/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Switch } from '@renderer/lib/ui/switch';
import { cn } from '@renderer/utils/utils';
import { ContextProgressBar, RuntimeBarSeparator, RuntimeMetricRow } from '../bar-chrome';
import {
  formatAbsoluteDateTime,
  formatAccountResetCreditExpiry,
  formatResetCountdown,
  getUsageTone,
} from '../display';
import { useRuntimeBarMaas } from '../maas-context';
import { WorkspaceMaasUsageContent } from '../maas-usage-content';
import { useRuntimeBarSession } from '../session-context';
import { useRuntimeBarSessionUsage } from '../session-usage';

/**
 * How much of the account's quota is spent. Which account that is depends on how
 * the session authenticates: a bound model-access Profile answers for itself,
 * otherwise the runtime's own subscription does. Both read as one entry because
 * the question — "how much have I got left?" — is the same either way.
 */
export const RuntimeBarAccountUsageItem = observer(function RuntimeBarAccountUsageItem() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const showConfirmActionModal = useShowModal('confirmActionModal');
  const [isResettingAccountUsage, setIsResettingAccountUsage] = useState(false);
  const [accountUsageWarningThresholdDraft, setAccountUsageWarningThresholdDraft] = useState('95');
  const notifiedAccountUsageWindowsRef = useRef(new Set<string>());
  const { value: notificationSettings, update: updateNotificationSettings } =
    useAppSettingsKey('notifications');
  const { runtimeId, runtime, connectionId } = useRuntimeBarSession();
  const maas = useRuntimeBarMaas(runtimeId);
  const maasPresentation = maas.presentation;
  const maasActiveForRuntime = maas.activeForRuntime;
  const { sessionContext, sessionAuthProvider } = useRuntimeBarSessionUsage();
  const {
    summary: maasUsage,
    loading: isLoadingMaasUsage,
    reloading: isRefreshingMaasUsage,
    reload: refreshMaasUsage,
    error: maasUsageError,
  } = useMaasUsageSummary(maas.activePlatformId, 'all', maasActiveForRuntime);
  const officialCodexAccountAvailable = shouldReadOfficialAccountUsage(
    runtimeId,
    connectionId,
    maasActiveForRuntime
  );
  const officialUsageUrl = runtimeId
    ? getRuntimeAccountProfile(runtimeId).officialSubscription.usageUrl
    : undefined;
  const {
    data: accountUsage,
    refetch: refreshAccountUsageQuery,
    isFetching: isRefreshingUsage,
  } = useQuery<AgentAccountUsage>({
    queryKey: ['runtimeSettings', runtimeId, 'accountUsage'],
    queryFn: () => {
      if (!runtimeId) throw new Error('A runtime is required to read account usage.');
      return rpc.runtimeSettings.getAccountUsage(runtimeId) as Promise<AgentAccountUsage>;
    },
    enabled: officialCodexAccountAvailable,
    staleTime: 60_000,
    refetchInterval: (notificationSettings?.accountUsageWarningEnabled ?? true) ? 60_000 : false,
    refetchOnWindowFocus: true,
  });
  const accountRateLimits = resolveAccountRateLimits({
    accountUsage,
    maasActiveForRuntime,
    sessionRateLimits: sessionContext?.rateLimits,
  });
  const shortAccountWindow = accountRateLimits[0] ?? null;
  const accountUsageSupportsResetCreditDetails =
    accountUsage == null || Object.prototype.hasOwnProperty.call(accountUsage, 'resetCredits');
  const nextAccountResetCredit = getNextAccountResetCredit(accountUsage?.resetCredits);
  const accountUsageWarningEnabled = notificationSettings?.accountUsageWarningEnabled ?? true;
  const accountUsageWarningThreshold = notificationSettings?.accountUsageWarningThreshold ?? 95;
  useEffect(() => {
    setAccountUsageWarningThresholdDraft(String(accountUsageWarningThreshold));
  }, [accountUsageWarningThreshold]);
  /**
   * Which kind of account is being spent. A live model-access binding decides
   * the card's branch, so it decides the type too; otherwise the mode recorded
   * on the session at spawn time answers. Naming *which* platform, and rebinding
   * it, belong to the model-access entry — this card only says what type it is.
   */
  const accountProviderId: AgentAccountProviderId | null = maasActiveForRuntime
    ? 'yoda-maas'
    : sessionAuthProvider;
  const usageTriggerLabel = t('workspaceRuntime.accountUsage');

  const manageAccount = () => {
    if (!runtimeId || connectionId) return;
    appState.sidePane.pinView('settings', { tab: 'clis-models', runtimeId });
  };

  const handleAccountUsagePopoverOpen = (open: boolean) => {
    if (open && officialCodexAccountAvailable) {
      void refreshAccountUsageQuery();
    }
    if (open && maasActiveForRuntime) {
      refreshMaasUsage();
    }
  };

  const copyMaasUsageError = useCallback(
    (usageError: string | null = maasUsageError) => {
      if (!usageError) return;
      const diagnostics = [
        `runtime=${runtimeId ?? 'unknown'}`,
        `platform=${maas.activePlatformId ?? 'unknown'}`,
        `provider=${maasPresentation.providerName ?? 'unknown'}`,
        `error=${usageError}`,
      ].join('\n');
      void copyTextToClipboard(diagnostics)
        .then(() => toast.success(t('workspaceRuntime.maasUsageErrorCopied')))
        .catch((error) =>
          toast.error(t('common.copyFailed'), {
            description: error instanceof Error ? error.message : String(error),
          })
        );
    },
    [maas.activePlatformId, maasPresentation.providerName, maasUsageError, runtimeId, t, toast]
  );

  const resetAccountUsage = useCallback(async () => {
    if (!officialCodexAccountAvailable || !runtimeId) return;
    setIsResettingAccountUsage(true);
    try {
      const result = await rpc.runtimeSettings.resetAccountUsage(runtimeId, {
        creditId: nextAccountResetCredit?.id,
      });
      if (result.error || !result.outcome) {
        toast.error(t('workspaceRuntime.accountUsageResetFailed'));
        return;
      }
      if (result.outcome === 'nothingToReset') {
        toast(t('workspaceRuntime.accountUsageNothingToReset'));
        return;
      }
      if (result.outcome === 'noCredit') {
        toast.error(t('workspaceRuntime.accountUsageNoResetCredit'));
        await refreshAccountUsageQuery();
        return;
      }
      await refreshAccountUsageQuery();
      toast.success(t('workspaceRuntime.accountUsageResetSuccess'));
    } catch {
      toast.error(t('workspaceRuntime.accountUsageResetFailed'));
    } finally {
      setIsResettingAccountUsage(false);
    }
  }, [
    nextAccountResetCredit?.id,
    officialCodexAccountAvailable,
    refreshAccountUsageQuery,
    runtimeId,
    t,
    toast,
  ]);

  const confirmAccountUsageReset = useCallback(() => {
    showConfirmActionModal({
      title: t('workspaceRuntime.confirmAccountUsageResetTitle'),
      description: nextAccountResetCredit?.expiresAt
        ? t('workspaceRuntime.confirmAccountUsageResetDescriptionWithExpiry', {
            time: formatAccountResetCreditExpiry(nextAccountResetCredit.expiresAt),
          })
        : t('workspaceRuntime.confirmAccountUsageResetDescription'),
      confirmLabel: t('workspaceRuntime.resetAccountUsage'),
      variant: 'default',
      onSuccess: () => void resetAccountUsage(),
    });
  }, [nextAccountResetCredit?.expiresAt, resetAccountUsage, showConfirmActionModal, t]);

  const commitAccountUsageWarningThreshold = () => {
    const threshold = Number(accountUsageWarningThresholdDraft);
    if (Number.isInteger(threshold) && threshold >= 1 && threshold <= 100) {
      updateNotificationSettings({ accountUsageWarningThreshold: threshold });
      return;
    }
    setAccountUsageWarningThresholdDraft(String(accountUsageWarningThreshold));
  };

  useEffect(() => {
    if (
      !accountUsageWarningEnabled ||
      !officialCodexAccountAvailable ||
      !accountUsage ||
      accountUsage.error
    ) {
      return;
    }

    const alert = getAccountUsageThresholdAlert(
      accountUsage.rateLimits,
      accountUsageWarningThreshold,
      notifiedAccountUsageWindowsRef.current
    );
    if (!alert) return;

    for (const key of alert.notificationKeys) {
      notifiedAccountUsageWindowsRef.current.add(key);
    }

    const percent = Math.round(alert.window.usedPercent);
    const windowLabel = getQuotaWindowLabel(alert.window.windowMinutes);
    const windowName = t(windowLabel.translationKey, { value: windowLabel.value });
    toast({
      title: t('workspaceRuntime.accountUsageThresholdTitle', { percent }),
      description: t('workspaceRuntime.accountUsageThresholdDescription', {
        window: windowName,
        threshold: accountUsageWarningThreshold,
      }),
      ...(accountUsage?.resetCreditsAvailable != null && accountUsage.resetCreditsAvailable > 0
        ? {
            action: {
              label: t('workspaceRuntime.resetAccountUsage'),
              onClick: confirmAccountUsageReset,
            },
          }
        : {}),
    });
  }, [
    accountUsage,
    accountUsageWarningEnabled,
    accountUsageWarningThreshold,
    confirmAccountUsageReset,
    officialCodexAccountAvailable,
    t,
    toast,
  ]);

  if (!maasActiveForRuntime && !shortAccountWindow && !officialCodexAccountAvailable) return null;

  return (
    <>
      <RuntimeBarSeparator />
      <Popover onOpenChange={handleAccountUsagePopoverOpen}>
        <PopoverTrigger
          aria-label={usageTriggerLabel}
          className="flex h-5 shrink-0 items-center gap-1 rounded-sm px-1 text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
          title={usageTriggerLabel}
        >
          <Gauge aria-hidden className="size-3.5" />
          <span className="@max-[1120px]:hidden">{t('workspaceRuntime.accountUsageShort')}</span>
          {shortAccountWindow ? (
            <ContextProgressBar
              compact
              percent={Math.round(shortAccountWindow.usedPercent)}
              tone={getUsageTone(Math.round(shortAccountWindow.usedPercent))}
            />
          ) : null}
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="top"
          sideOffset={8}
          className={cn(WORKSPACE_BAR_CARD_CLASS, 'w-[21rem] max-w-[calc(100vw-1rem)]')}
        >
          {/* One card, one identity. Both branches answer the same question, so
              they share the header and differ only in the figures below it. */}
          <WorkspaceBarCardHeader
            icon={Gauge}
            title={t('workspaceRuntime.accountUsage')}
            titleBadge={
              accountProviderId ? (
                <Badge variant="secondary">{t(accountProviderLabelKey(accountProviderId))}</Badge>
              ) : null
            }
            description={t('workspaceRuntime.accountUsageCardDescription')}
            actions={
              <WorkspaceBarCardMenu>
                <DropdownMenuItem
                  onClick={() => void rpc.app.openExternal(YODA_ACCOUNT_USAGE_DOC_URL)}
                >
                  <ExternalLink aria-hidden />
                  {t('workspaceRuntime.accountDocs')}
                </DropdownMenuItem>
                {!maasActiveForRuntime && officialUsageUrl ? (
                  <DropdownMenuItem onClick={() => void rpc.app.openExternal(officialUsageUrl)}>
                    <ExternalLink aria-hidden />
                    {t('workspaceRuntime.officialAccountUsage', {
                      name: runtime?.name ?? runtimeId,
                    })}
                  </DropdownMenuItem>
                ) : null}
              </WorkspaceBarCardMenu>
            }
          />
          {maasActiveForRuntime ? (
            <WorkspaceMaasUsageContent
              providerName={maasPresentation.providerName ?? t('workspaceRuntime.maas.title')}
              usage={maasUsage}
              loading={isLoadingMaasUsage}
              refreshing={isRefreshingMaasUsage}
              error={maasUsageError}
              onRefresh={refreshMaasUsage}
              onCopyError={copyMaasUsageError}
            />
          ) : (
            <>
              <WorkspaceBarCardSection className="flex flex-col gap-3">
                {accountRateLimits.map((limit) => {
                  const percent = Math.round(limit.usedPercent);
                  const windowLabel = getQuotaWindowLabel(limit.windowMinutes);
                  return (
                    <div key={limit.windowMinutes} className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="text-foreground-muted">
                          {t(windowLabel.translationKey, {
                            value: windowLabel.value,
                          })}
                        </span>
                        <span className="font-mono tabular-nums text-foreground">{percent}%</span>
                      </div>
                      <ContextProgressBar percent={percent} tone={getUsageTone(percent)} />
                      <span className="text-[11px] text-foreground-passive">
                        {t('workspaceRuntime.accountQuotaStatus', {
                          remaining: Math.max(0, 100 - percent),
                          reset: limit.resetsAt
                            ? formatResetCountdown(limit.resetsAt)
                            : t('tasks.sessionInfo.unknown'),
                        })}
                      </span>
                    </div>
                  );
                })}
              </WorkspaceBarCardSection>
              {runtimeId === 'codex' && !connectionId ? (
                <WorkspaceBarCardSection>
                  <WorkspaceBarCardRow
                    label={t('workspaceRuntime.accountUsageWarning')}
                    description={t('workspaceRuntime.accountUsageWarningDescription')}
                    control={
                      <Switch
                        size="sm"
                        checked={accountUsageWarningEnabled}
                        onCheckedChange={(enabled) =>
                          updateNotificationSettings({
                            accountUsageWarningEnabled: enabled,
                          })
                        }
                        aria-label={t('workspaceRuntime.accountUsageWarning')}
                      />
                    }
                  />
                  {accountUsageWarningEnabled ? (
                    <WorkspaceBarCardRow
                      className="mt-2.5"
                      label={
                        <label htmlFor="account-usage-warning-threshold">
                          {t('workspaceRuntime.accountUsageWarningThreshold')}
                        </label>
                      }
                      control={
                        <>
                          <Input
                            id="account-usage-warning-threshold"
                            type="number"
                            min={1}
                            max={100}
                            step={1}
                            value={accountUsageWarningThresholdDraft}
                            className="h-7 w-16 text-right font-mono tabular-nums"
                            onChange={(event) =>
                              setAccountUsageWarningThresholdDraft(event.target.value)
                            }
                            onBlur={commitAccountUsageWarningThreshold}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.currentTarget.blur();
                                return;
                              }
                              if (event.key === 'Escape') {
                                setAccountUsageWarningThresholdDraft(
                                  String(accountUsageWarningThreshold)
                                );
                                event.currentTarget.blur();
                              }
                            }}
                          />
                          <span className="text-xs text-foreground-passive">%</span>
                        </>
                      }
                    />
                  ) : null}
                </WorkspaceBarCardSection>
              ) : null}
              {runtimeId === 'codex' && !connectionId ? (
                <WorkspaceBarCardSection className="flex flex-col gap-1.5 text-xs">
                  <RuntimeMetricRow
                    label={t('workspaceRuntime.accountResetCredits')}
                    value={
                      accountUsage?.resetCreditsAvailable != null
                        ? t('workspaceRuntime.accountResetCreditsCount', {
                            count: accountUsage.resetCreditsAvailable,
                          })
                        : accountUsage?.error
                          ? t('workspaceRuntime.accountResetCreditsFailed')
                          : t('workspaceRuntime.accountResetCreditsLoading')
                    }
                  />
                  {accountUsage?.resetCreditsAvailable != null &&
                  accountUsage.resetCreditsAvailable > 0 ? (
                    <RuntimeMetricRow
                      label={t('workspaceRuntime.accountResetCreditExpiry')}
                      value={
                        nextAccountResetCredit?.expiresAt
                          ? t('workspaceRuntime.accountResetCreditExpiresAt', {
                              time: formatAccountResetCreditExpiry(
                                nextAccountResetCredit.expiresAt
                              ),
                            })
                          : nextAccountResetCredit
                            ? t('workspaceRuntime.accountResetCreditNoExpiry')
                            : t(
                                accountUsageSupportsResetCreditDetails
                                  ? 'workspaceRuntime.accountResetCreditExpiryUnknown'
                                  : 'workspaceRuntime.accountResetCreditRestartRequired'
                              )
                      }
                      title={
                        nextAccountResetCredit?.expiresAt
                          ? formatAbsoluteDateTime(nextAccountResetCredit.expiresAt)
                          : t(
                              accountUsageSupportsResetCreditDetails
                                ? 'workspaceRuntime.accountResetCreditExpiryUnknownDescription'
                                : 'workspaceRuntime.accountResetCreditRestartRequiredDescription'
                            )
                      }
                    />
                  ) : null}
                </WorkspaceBarCardSection>
              ) : null}
              <WorkspaceBarCardFooter>
                <p className="mb-2 text-[11px] leading-relaxed text-foreground-passive">
                  {t('workspaceRuntime.accountQuotaResetDescription')}
                </p>
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    disabled={
                      isRefreshingUsage ||
                      isResettingAccountUsage ||
                      accountUsage?.resetCreditsAvailable == null ||
                      accountUsage.resetCreditsAvailable <= 0
                    }
                    size="sm"
                    variant="outline"
                    onClick={confirmAccountUsageReset}
                  >
                    {isResettingAccountUsage
                      ? t('workspaceRuntime.resettingAccountUsage')
                      : accountUsage?.resetCreditsAvailable === 0
                        ? t('workspaceRuntime.noAccountResetCredits')
                        : t('workspaceRuntime.resetAccountUsage')}
                  </Button>
                  {!connectionId ? (
                    <Button className="flex-1" size="sm" variant="outline" onClick={manageAccount}>
                      {t('workspaceRuntime.manageAccount')}
                    </Button>
                  ) : null}
                </div>
              </WorkspaceBarCardFooter>
            </>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
});

/**
 * The account API answers first when it can. A bound Profile means the runtime's
 * own subscription is not the account being spent, so its session-reported
 * windows are dropped rather than shown as a second, contradictory quota.
 */
function resolveAccountRateLimits({
  accountUsage,
  maasActiveForRuntime,
  sessionRateLimits,
}: {
  accountUsage: AgentAccountUsage | undefined;
  maasActiveForRuntime: boolean;
  sessionRateLimits: AgentAccountUsage['rateLimits'] | undefined;
}): AgentAccountUsage['rateLimits'] {
  if (accountUsage && !accountUsage.error && accountUsage.rateLimits.length > 0) {
    return accountUsage.rateLimits;
  }
  return maasActiveForRuntime ? [] : (sessionRateLimits ?? []);
}
