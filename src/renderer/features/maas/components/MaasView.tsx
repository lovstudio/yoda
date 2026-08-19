import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  ChevronDown,
  Copy,
  Ellipsis,
  ExternalLink,
  Globe2,
  GripVertical,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  SquareTerminal,
  Trash2,
  X,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createMaasProfileId,
  getMaasPlatformDefinition,
  getMaasPlatformTemplateId,
  hasMaasInferenceCredential,
  isMaasPlatformId,
  isValidMaasEnvKey,
  MAAS_MANAGED_GATEWAY_IDS,
  resolveMaasEnvKey,
  type MaasApiKeyKind,
  type MaasConnection,
  type MaasLocalIntegrationId,
  type MaasManagedGatewayId,
  type MaasPlatformId,
  type MaasPlatformTemplateId,
} from '@shared/maas';
import { YODA_MAAS_DOCS_URL } from '@shared/urls';
import { HeaderActionButton, HeaderActionToolbar } from '@renderer/lib/components/header-actions';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { reorderIdsInVisibleList } from '@renderer/lib/reorder-ids';
import { appState } from '@renderer/lib/stores/app-state';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@renderer/lib/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Input } from '@renderer/lib/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@renderer/lib/ui/input-group';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Switch } from '@renderer/lib/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { getVisibleMaasPlatformIds } from '../maas-platform-list';
import {
  useCheckMaasConnection,
  useCodexClientSyncStatus,
  useConnectMaasPlatform,
  useDisconnectMaasPlatform,
  useDuplicateMaasProfile,
  useMaasConnections,
  useMaasGlobalBinding,
  useMaasManagedGatewayStars,
  useReorderMaasConnections,
  useSetCodexClientSync,
  useSetMaasGlobalBinding,
} from '../useMaas';
import type { NewMaasProfileDraft } from './AddMaasProfileModal';
import { CcSwitchIntegrationCard } from './CcSwitchIntegrationCard';
import { CliProxyApiManagedCard } from './CliProxyApiManagedCard';
import { LiteLlmManagedCard } from './LiteLlmManagedCard';
import { ManagedGatewayStarTrend } from './ManagedGatewayStarTrend';
import { NewApiManagedCard } from './NewApiManagedCard';

function isManagedGatewayId(platformId: MaasPlatformId): platformId is MaasManagedGatewayId {
  return (MAAS_MANAGED_GATEWAY_IDS as readonly MaasPlatformId[]).includes(platformId);
}

function findConnection(
  connections: MaasConnection[] | undefined,
  platformId: MaasPlatformId,
  draft?: NewMaasProfileDraft
): MaasConnection {
  const platform = getMaasPlatformDefinition(platformId);
  return (
    connections?.find((connection) => connection.platformId === platformId) ?? {
      platformId,
      displayName: draft?.displayName ?? platform.name,
      endpoint: draft?.endpoint ?? platform.defaultEndpoint,
      websiteUrl: draft?.websiteUrl,
      description: draft?.description,
      logoUrl: draft?.logoUrl,
      keyFingerprint: null,
      inferenceKeyFingerprint: null,
      connectedAt: null,
      lastCheckedAt: null,
      lastTest: null,
      configured: false,
      connected: false,
      error: null,
    }
  );
}

function formatDateTime(value: string | null): string {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

const ProfileLastActivity: React.FC<{ connection: MaasConnection }> = ({ connection }) => {
  const { t } = useTranslation();
  const checkedAt = connection.lastTest?.checkedAt ?? connection.lastCheckedAt;

  if (!checkedAt) {
    return (
      <span
        data-testid="maas-profile-last-activity"
        className="shrink-0 text-[11px] text-foreground-muted"
      >
        {t('maas.connection.neverChecked')}
      </span>
    );
  }

  const failed = connection.lastTest?.ok === false;
  return (
    <span
      data-testid="maas-profile-last-activity"
      title={formatDateTime(checkedAt)}
      className={cn(
        'shrink-0 text-[11px] tabular-nums',
        failed ? 'text-amber-600 dark:text-amber-400' : 'text-foreground-muted'
      )}
    >
      <span>{t(failed ? 'maas.connection.lastCheckFailed' : 'maas.connection.lastVerified')} </span>
      <RelativeTime value={checkedAt} />
      {connection.lastTest?.averageLatencyMs != null ? (
        <span>
          {t('maas.connection.testSpeed', {
            latency: connection.lastTest.averageLatencyMs,
          })}
        </span>
      ) : null}
    </span>
  );
};

function formatMaskedApiKey(fingerprint: string | null): string {
  const value = fingerprint?.trim();
  if (!value) return '****';
  if (value.startsWith('...')) return `****${value}`;
  return value;
}

export const MaasConnectedCountBadge: React.FC = () => {
  const { t } = useTranslation();
  const { data: connections } = useMaasConnections();
  const connectedCount = connections?.filter((connection) => connection.connected).length ?? 0;

  return <Badge variant="secondary">{t('maas.connectedCount', { count: connectedCount })}</Badge>;
};

const ExternalAgentSyncSettingsCard: React.FC = observer(() => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const statusQuery = useCodexClientSyncStatus();
  const setSync = useSetCodexClientSync();
  const showConfirm = useShowModal('confirmActionModal');
  const status = statusQuery.data;
  const enabled = status?.enabled === true;
  const claudePublished = Boolean(
    status?.claude?.managed &&
      status.claude?.configManaged &&
      status.claude?.persistentCredentialStored
  );
  const published = Boolean(
    status?.enabled &&
      status.managed &&
      status.configManaged &&
      status.persistentCredentialStored &&
      (!status.claude?.compatible || claudePublished)
  );
  const partial = statusQuery.isError || Boolean(enabled && status?.platformId && !published);
  const codexDetected = appState.dependencies.agentStatuses.codex?.status === 'available';
  const claudeDetected = appState.dependencies.agentStatuses.claude?.status === 'available';

  const applySync = (next: boolean) => {
    setSync.mutate(
      { enabled: next },
      {
        onSuccess: () =>
          toast({ title: t(`maas.clientSync.${next ? 'enabledToast' : 'disabledToast'}`) }),
        onError: (error) =>
          toast({
            title: t('maas.clientSync.updateFailed'),
            description: error instanceof Error ? error.message : String(error),
            variant: 'destructive',
          }),
      }
    );
  };

  const handleToggle = (next: boolean) => {
    if (!next) {
      applySync(false);
      return;
    }
    showConfirm({
      title: t('maas.clientSync.enableConfirmTitle'),
      description: t('maas.clientSync.enableConfirmDescription'),
      confirmLabel: t('maas.clientSync.enableConfirmLabel'),
      onSuccess: () => applySync(true),
    });
  };

  return (
    <section
      data-testid="external-agent-sync-settings"
      className="overflow-hidden rounded-2xl border border-border/60 bg-background-1/75 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
    >
      <div className="flex min-w-0 items-start gap-3 px-4 py-3.5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-[9px]',
              published
                ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'
                : partial
                  ? 'bg-amber-500/12 text-amber-600 dark:text-amber-400'
                  : enabled
                    ? 'bg-primary/10 text-primary'
                    : 'bg-foreground/5 text-foreground-muted'
            )}
          >
            {partial ? (
              <AlertTriangle className="size-4" />
            ) : enabled ? (
              <ShieldCheck className="size-4" />
            ) : (
              <Globe2 className="size-4" />
            )}
          </div>
          <div className="min-w-0">
            <h3 className="text-[13px] font-medium text-foreground">
              {t('maas.clientSync.title')}
            </h3>
            <p className="mt-0.5 text-xs leading-relaxed text-foreground-muted">
              {published
                ? t('maas.clientSync.activeDetail', {
                    profile: status?.displayName ?? status?.platformId,
                    clients: status?.claude?.compatible
                      ? t('maas.clientSync.codexAndClaude')
                      : 'Codex CLI / App',
                  })
                : partial
                  ? t('maas.clientSync.partialDetail')
                  : enabled
                    ? t('maas.clientSync.waitingDetail')
                    : t('maas.clientSync.inactiveDetail')}
            </p>
          </div>
        </div>
        <Switch
          checked={enabled}
          disabled={statusQuery.isLoading || setSync.isPending || status?.supported === false}
          aria-label={t('maas.clientSync.toggle')}
          onCheckedChange={handleToggle}
          className="mt-1 shrink-0"
        />
      </div>
      <div className="border-t border-border/50 bg-foreground/[0.018] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-medium text-foreground-muted">
            {t('maas.clientSync.agentClientAdapters')}
          </span>
          <span
            className="min-w-0 text-right [overflow-wrap:anywhere] text-[10px] text-foreground-passive"
            style={{ overflowWrap: 'anywhere' }}
          >
            {t('maas.clientSync.moreClientsLater')}
          </span>
        </div>
        <div className="mt-2 overflow-hidden rounded-xl border border-border/50 bg-background-1/70">
          <div
            data-testid="external-agent-client-codex"
            className="flex items-center justify-between gap-3 px-3 py-2.5"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.055] text-foreground-muted">
                <SquareTerminal className="size-3.5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-foreground">Codex CLI / App</p>
                <p className="mt-0.5 text-[10px] text-foreground-muted">
                  {t('maas.clientSync.adapted')}
                </p>
              </div>
            </div>
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 text-[11px]',
                codexDetected ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground-muted'
              )}
            >
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  codexDetected ? 'bg-emerald-500' : 'bg-foreground/25'
                )}
              />
              {t(codexDetected ? 'maas.clientSync.detected' : 'maas.clientSync.notDetected')}
            </span>
          </div>
          <div
            data-testid="external-agent-client-claude"
            className="flex items-center justify-between gap-3 border-t border-border/45 px-3 py-2.5"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.055] text-foreground-muted">
                <SquareTerminal className="size-3.5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-foreground">Claude Code</p>
                <p className="mt-0.5 text-[10px] text-foreground-muted">
                  {t('maas.clientSync.adapted')}
                </p>
              </div>
            </div>
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 text-[11px]',
                claudeDetected ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground-muted'
              )}
            >
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  claudeDetected ? 'bg-emerald-500' : 'bg-foreground/25'
                )}
              />
              {t(claudeDetected ? 'maas.clientSync.detected' : 'maas.clientSync.notDetected')}
            </span>
          </div>
        </div>
        {enabled ? (
          <p className="mt-2.5 text-[10px] leading-relaxed text-foreground-muted">
            {t('maas.clientSync.risk')}
          </p>
        ) : null}
      </div>
    </section>
  );
});

export const MaasView: React.FC<{
  embedded?: boolean;
  showSectionChrome?: boolean;
  requestedPlatformId?: MaasPlatformTemplateId | MaasPlatformId;
  onOpenMarketplace?: () => void;
}> = ({ embedded = false, showSectionChrome = true, requestedPlatformId }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: connections, isLoading } = useMaasConnections();
  const globalBinding = useMaasGlobalBinding();
  const setGlobalBinding = useSetMaasGlobalBinding();
  const reorderConnections = useReorderMaasConnections();
  const sortingSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const managedGatewayStarsQuery = useMaasManagedGatewayStars();
  const showZenmuxUsage = useShowModal('zenmuxUsageModal');
  const showAddProfile = useShowModal('addMaasProfileModal');
  const [initialRequestedPlatformId] = useState<MaasPlatformId | undefined>(() =>
    requestedPlatformId === 'custom' ? createMaasProfileId() : requestedPlatformId
  );
  const [expandedPlatformId, setExpandedPlatformId] = useState<MaasPlatformId | ''>(
    initialRequestedPlatformId ?? ''
  );
  const [draftPlatformIds, setDraftPlatformIds] = useState<MaasPlatformId[]>(
    initialRequestedPlatformId ? [initialRequestedPlatformId] : []
  );
  const [draftProfiles, setDraftProfiles] = useState<Map<MaasPlatformId, NewMaasProfileDraft>>(
    () => new Map()
  );
  const [managedConnectionPlatformId, setManagedConnectionPlatformId] =
    useState<MaasManagedGatewayId | null>(() =>
      initialRequestedPlatformId && isManagedGatewayId(initialRequestedPlatformId)
        ? initialRequestedPlatformId
        : null
    );
  const allVisiblePlatformIds = useMemo(
    () => getVisibleMaasPlatformIds(connections, draftPlatformIds),
    [connections, draftPlatformIds]
  );
  const visiblePlatformIds = useMemo(
    () =>
      allVisiblePlatformIds.filter(
        (platformId) => !isManagedGatewayId(getMaasPlatformTemplateId(platformId))
      ),
    [allVisiblePlatformIds]
  );
  /** Saved Profiles in the visible list — drafts have no persisted slot to reorder. */
  const sortablePlatformIds = useMemo(
    () => visiblePlatformIds.filter((platformId) => !draftPlatformIds.includes(platformId)),
    [visiblePlatformIds, draftPlatformIds]
  );
  const managedGatewayStarsById = useMemo(
    () =>
      new Map(
        managedGatewayStarsQuery.data?.map((snapshot) => [snapshot.platformId, snapshot]) ?? []
      ),
    [managedGatewayStarsQuery.data]
  );
  const getManagedGatewayStarCount = (integrationId: MaasLocalIntegrationId) =>
    managedGatewayStarsQuery.isPending
      ? undefined
      : (managedGatewayStarsById.get(integrationId)?.starCount ?? null);

  const handlePlatformValueChange = useCallback((value: string) => {
    if (value === '') {
      setExpandedPlatformId('');
      return;
    }
    if (!isMaasPlatformId(value)) return;
    setExpandedPlatformId(value);
  }, []);

  const handleAddProfile = useCallback(() => {
    showAddProfile({
      onSuccess: (draft) => {
        const platformId = createMaasProfileId();
        setDraftProfiles((current) => new Map(current).set(platformId, draft));
        setDraftPlatformIds((current) => [...current, platformId]);
        setExpandedPlatformId(platformId);
      },
    });
  }, [showAddProfile]);

  const handleCancelDraft = useCallback((platformId: MaasPlatformId) => {
    setDraftPlatformIds((current) => current.filter((id) => id !== platformId));
    setDraftProfiles((current) => {
      const next = new Map(current);
      next.delete(platformId);
      return next;
    });
    setExpandedPlatformId((current) => (current === platformId ? '' : current));
    setManagedConnectionPlatformId((current) => (current === platformId ? null : current));
  }, []);

  const handlePlatformConnected = useCallback((platformId: MaasPlatformId) => {
    setDraftPlatformIds((current) => current.filter((id) => id !== platformId));
    setDraftProfiles((current) => {
      const next = new Map(current);
      next.delete(platformId);
      return next;
    });
  }, []);

  const handleOpenManagedConnection = useCallback((platformId: MaasManagedGatewayId) => {
    setDraftPlatformIds((current) =>
      current.includes(platformId) ? current : [...current, platformId]
    );
    setManagedConnectionPlatformId(platformId);
    setExpandedPlatformId(platformId);
  }, []);

  const handlePlatformEnabledChange = useCallback(
    (connection: MaasConnection, enabled: boolean) => {
      setGlobalBinding.mutate(
        { platformId: connection.platformId, enabled },
        {
          onSuccess: () => {
            toast({
              title: enabled
                ? t('maas.global.enabledToast', { platform: connection.displayName })
                : t('maas.global.restoredToast'),
              description: t('maas.global.codexRestartNotice'),
            });
          },
          onError: (error) => {
            toast({
              title: t('maas.global.updateFailed'),
              description: error instanceof Error ? error.message : String(error),
              variant: 'destructive',
            });
          },
        }
      );
    },
    [setGlobalBinding, t, toast]
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const overId = event.over?.id;
    if (overId === undefined || overId === event.active.id) return;
    const savedPlatformIds = connections?.map((connection) => connection.platformId) ?? [];
    const reordered = reorderIdsInVisibleList(
      savedPlatformIds,
      sortablePlatformIds,
      String(event.active.id),
      String(overId)
    );
    if (reordered === savedPlatformIds) return;
    const nextOrder = reordered.filter(isMaasPlatformId);
    if (nextOrder.length !== savedPlatformIds.length) return;
    reorderConnections.mutate(nextOrder, {
      onError: (error) =>
        toast({
          title: t('maas.profile.reorderFailed'),
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        }),
    });
  };

  const renderPlatformAccordion = (platformIds: MaasPlatformId[], sortable = false) => {
    const accordion = (
      <AccordionPrimitive.Root
        type="single"
        collapsible
        value={expandedPlatformId}
        onValueChange={handlePlatformValueChange}
        className={cn(
          'overflow-hidden rounded-2xl border border-border/55 bg-background-1/70 shadow-[0_1px_2px_rgba(0,0,0,0.035)]',
          sortable && 'group/maas-profiles'
        )}
      >
        {platformIds.map((platformId) => {
          const connection = findConnection(connections, platformId, draftProfiles.get(platformId));
          const isDraft = !connection.configured && draftPlatformIds.includes(platformId);
          const templateId = getMaasPlatformTemplateId(platformId);
          const enabled = Boolean(
            globalBinding.data?.enabled && globalBinding.data.platformId === platformId
          );
          const platformConfigured = Boolean(
            connection.connected && hasMaasInferenceCredential(connection)
          );
          const enableAvailable = platformConfigured;
          const enablePending = Boolean(
            setGlobalBinding.isPending &&
              setGlobalBinding.variables?.platformId === connection.platformId
          );
          const itemProps = {
            connection,
            onOpenUsage:
              templateId === 'zenmux' ? () => showZenmuxUsage({ platformId }) : undefined,
            onCancelDraft: isDraft ? () => handleCancelDraft(platformId) : undefined,
            onConnected: () => handlePlatformConnected(platformId),
            onDuplicated: (duplicate: MaasConnection) =>
              setExpandedPlatformId(duplicate.platformId),
            enabled,
            enableAvailable,
            enablePending,
            enableUpdating: setGlobalBinding.isPending,
            onEnabledChange: (next: boolean) => handlePlatformEnabledChange(connection, next),
          };
          // Drafts are not persisted yet, so they stay out of the sortable list.
          if (!sortable || isDraft) {
            return (
              <PlatformAccordionItem
                key={platformId}
                {...itemProps}
                dragHandle={sortable ? MAAS_PROFILE_GUTTER : undefined}
              />
            );
          }
          return (
            <SortablePlatformAccordionItem
              key={platformId}
              {...itemProps}
              disabled={reorderConnections.isPending}
            />
          );
        })}
      </AccordionPrimitive.Root>
    );

    if (!sortable) return accordion;
    return (
      <DndContext
        sensors={sortingSensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={platformIds.filter((platformId) => !draftPlatformIds.includes(platformId))}
          strategy={verticalListSortingStrategy}
        >
          {accordion}
        </SortableContext>
      </DndContext>
    );
  };

  const platformSections =
    visiblePlatformIds.length > 0 ? (
      renderPlatformAccordion(visiblePlatformIds, sortablePlatformIds.length > 1)
    ) : (
      <div className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/10 px-6 py-8 text-center">
        <Layers className="h-5 w-5 text-foreground-muted" />
        <h4 className="mt-3 text-sm font-medium text-foreground">{t('maas.emptyTitle')}</h4>
        <p className="mt-1 max-w-md text-xs leading-relaxed text-foreground-muted">
          {t('maas.emptyDescription')}
        </p>
      </div>
    );

  const content = (
    <div
      className={cn(
        'flex min-h-0 flex-col gap-7',
        embedded ? 'w-full' : 'mx-auto w-full max-w-4xl px-6 py-7'
      )}
    >
      <ExternalAgentSyncSettingsCard />
      {showSectionChrome ? (
        <MaasChapter
          title={t('maas.cloudProfiles.title')}
          description={t('maas.cloudProfiles.description')}
          action={
            <div className="flex flex-wrap items-center justify-end gap-2.5">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('maas.cloudProfiles.docs')}
                      onClick={() => void rpc.app.openExternal(YODA_MAAS_DOCS_URL)}
                    >
                      <BookOpen className="h-3.5 w-3.5" />
                    </Button>
                  }
                />
                <TooltipContent>{t('maas.cloudProfiles.docs')}</TooltipContent>
              </Tooltip>
              <Button type="button" size="sm" disabled={isLoading} onClick={handleAddProfile}>
                <Plus className="h-3.5 w-3.5" />
                {t('maas.addProfile')}
              </Button>
            </div>
          }
        >
          {platformSections}
        </MaasChapter>
      ) : (
        platformSections
      )}
      <MaasChapter
        title={t('maas.managedGateways.title')}
        description={t('maas.managedGateways.description')}
        action={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void rpc.app.openExternal(`${YODA_MAAS_DOCS_URL}#local-integrations`)}
          >
            <BookOpen className="h-3.5 w-3.5" />
            {t('maas.managedGateways.integrationDocs')}
          </Button>
        }
      >
        <div className="grid gap-3 @4xl:grid-cols-2" data-testid="maas-managed-gateway-cards">
          <LiteLlmManagedCard
            starCount={getManagedGatewayStarCount('litellm')}
            onOpenManualSettings={() => handleOpenManagedConnection('litellm')}
          />
          <CliProxyApiManagedCard
            starCount={getManagedGatewayStarCount('cliproxyapi')}
            onOpenManualSettings={() => handleOpenManagedConnection('cliproxyapi')}
          />
          <NewApiManagedCard
            starCount={getManagedGatewayStarCount('newapi')}
            onOpenManualSettings={() => handleOpenManagedConnection('newapi')}
          />
          <CcSwitchIntegrationCard starCount={getManagedGatewayStarCount('ccswitch')} />
        </div>
        <ManagedGatewayStarTrend
          snapshots={managedGatewayStarsQuery.data}
          isPending={managedGatewayStarsQuery.isPending}
        />
        {managedConnectionPlatformId && (
          <div className="grid gap-2.5" data-testid="maas-managed-connection-settings">
            <div className="flex items-center justify-between gap-3 px-0.5">
              <div>
                <h4 className="text-xs font-medium text-foreground">
                  {t('maas.managedGateways.connectionSettings')}
                </h4>
                <p className="mt-0.5 text-xs leading-relaxed text-foreground-muted">
                  {t('maas.managedGateways.connectionSettingsDescription')}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t('common.close')}
                onClick={() => setManagedConnectionPlatformId(null)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
            {renderPlatformAccordion([managedConnectionPlatformId])}
          </div>
        )}
      </MaasChapter>
    </div>
  );

  return (
    <div
      className={cn(
        // Container queries — this view also lives embedded in the narrow
        // settings side pane where viewport breakpoints lie.
        '@container flex min-h-0 bg-background text-foreground',
        embedded ? 'flex-col' : 'h-full flex-col overflow-y-auto'
      )}
    >
      {!embedded && (
        <div className="border-b border-border px-4 py-4">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-foreground-muted" />
            <h1 className="text-sm font-semibold">{t('maas.title')}</h1>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('maas.subtitle')}</p>
        </div>
      )}
      {content}
    </div>
  );
};

const MaasChapter: React.FC<{
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, description, action, children }) => {
  return (
    <section className="flex min-w-0 flex-col gap-3.5">
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-3 px-0.5">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
          {description && (
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-foreground-muted">
              {description}
            </p>
          )}
        </div>
        {action && <div className="flex min-w-0 flex-1 justify-end">{action}</div>}
      </div>
      {children}
    </section>
  );
};

type ConnectionEditorState = {
  dirty: boolean;
  canSave: boolean;
  saving: boolean;
};

const EMPTY_CONNECTION_EDITOR_STATE: ConnectionEditorState = {
  dirty: false,
  canSave: false,
  saving: false,
};

type PlatformAccordionItemProps = {
  connection: MaasConnection;
  onOpenUsage?: () => void;
  onCancelDraft?: () => void;
  onConnected: () => void;
  onDuplicated: (connection: MaasConnection) => void;
  enabled: boolean;
  enableAvailable: boolean;
  enablePending: boolean;
  enableUpdating: boolean;
  onEnabledChange: (enabled: boolean) => void;
};

const PlatformAccordionItem: React.FC<
  PlatformAccordionItemProps & {
    /** Rendered in the left gutter; pass a spacer to keep rows aligned in a sortable list. */
    dragHandle?: React.ReactNode;
    itemRef?: (node: HTMLElement | null) => void;
    itemStyle?: React.CSSProperties;
  }
> = ({
  connection,
  onOpenUsage,
  onCancelDraft,
  onConnected,
  onDuplicated,
  enabled,
  enableAvailable,
  enablePending,
  enableUpdating,
  onEnabledChange,
  dragHandle,
  itemRef,
  itemStyle,
}) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const disconnectMutation = useDisconnectMaasPlatform();
  const duplicateMutation = useDuplicateMaasProfile();
  const checkMutation = useCheckMaasConnection();
  const platform = getMaasPlatformDefinition(connection.platformId);
  const templateId = getMaasPlatformTemplateId(connection.platformId);
  const formId = `maas-profile-form-${useId()}`;
  const [editorState, setEditorState] = useState<ConnectionEditorState>(
    EMPTY_CONNECTION_EDITOR_STATE
  );

  const handleDisconnect = () => {
    disconnectMutation.mutate(connection.platformId, {
      onError: (error) =>
        toast({
          title: t('maas.connection.disconnectFailed'),
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        }),
    });
  };

  const handleDuplicate = () => {
    duplicateMutation.mutate(
      {
        platformId: connection.platformId,
        displayName: t('maas.profile.duplicateName', { name: connection.displayName }),
      },
      {
        onSuccess: (duplicate) => {
          onDuplicated(duplicate);
          toast({ title: t('maas.profile.duplicatedToast', { name: duplicate.displayName }) });
        },
        onError: (error) =>
          toast({
            title: t('maas.profile.duplicateFailed'),
            description: error instanceof Error ? error.message : String(error),
            variant: 'destructive',
          }),
      }
    );
  };

  const handleCheckConnection = () => {
    checkMutation.mutate(connection.platformId, {
      onSuccess: (result) => {
        if (result.ok) return;
        toast({
          title: t('maas.connection.testFailed'),
          description: result.error ?? t('maas.connection.testFailed'),
          variant: 'destructive',
        });
      },
      onError: (error) =>
        toast({
          title: t('maas.connection.testFailed'),
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        }),
    });
  };

  const enableUnavailableReason = t('maas.global.needsConfiguration');

  return (
    <AccordionPrimitive.Item
      ref={itemRef}
      style={itemStyle}
      value={connection.platformId}
      data-maas-platform-id={connection.platformId}
      className="border-b border-border/45 transition-colors last:border-b-0 data-[state=open]:bg-foreground/[0.018]"
    >
      <AccordionPrimitive.Header
        className={cn('flex items-center gap-1 pr-3', dragHandle ? 'pl-1' : undefined)}
      >
        {dragHandle}
        <AccordionPrimitive.Trigger
          className={cn(
            'group flex min-w-0 flex-1 items-center gap-3 py-3 pr-3.5 text-left outline-none transition-colors hover:bg-foreground/[0.025] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border',
            dragHandle ? 'pl-1.5' : 'pl-3.5'
          )}
        >
          <ChevronDown
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-200 group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
          <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-[8px] border border-border/35 bg-foreground/5">
            {connection.logoUrl ? (
              <img
                src={connection.logoUrl}
                alt=""
                className="size-5 object-contain"
                referrerPolicy="no-referrer"
              />
            ) : (
              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </span>
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-0.5">
            <span className="truncate text-sm font-medium text-foreground">
              {connection.displayName}
            </span>
            <ProfileLastActivity connection={connection} />
          </span>
        </AccordionPrimitive.Trigger>
        <HeaderActionToolbar label={t('maas.connection.profileActions')}>
          {editorState.dirty ? (
            <HeaderActionButton
              type="submit"
              form={formId}
              label={
                editorState.saving ? t('maas.connection.saving') : t('maas.connection.saveChanges')
              }
              disabled={!editorState.canSave || editorState.saving}
              data-testid="maas-profile-save"
            >
              {editorState.saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
            </HeaderActionButton>
          ) : null}
          <HeaderActionButton
            type="button"
            label={
              checkMutation.isPending ? t('maas.connection.testing') : t('maas.connection.test')
            }
            disabled={
              !connection.connected ||
              editorState.dirty ||
              editorState.saving ||
              checkMutation.isPending
            }
            onClick={handleCheckConnection}
            data-testid="maas-profile-test"
          >
            {checkMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Activity className="size-3.5" />
            )}
          </HeaderActionButton>
        </HeaderActionToolbar>
        <div className="flex shrink-0 items-center px-1">
          {enablePending ? (
            <Loader2 className="size-3.5 animate-spin text-foreground-muted" />
          ) : (
            <Switch
              size="sm"
              checked={enabled}
              disabled={enableUpdating || (!enableAvailable && !enabled)}
              aria-label={
                enabled
                  ? t('maas.global.disableAria', { platform: connection.displayName })
                  : t('maas.global.enableAria', { platform: connection.displayName })
              }
              title={
                !enableAvailable && !enabled
                  ? enableUnavailableReason
                  : enabled
                    ? t('maas.global.disableAria', { platform: connection.displayName })
                    : t('maas.global.enableAria', { platform: connection.displayName })
              }
              onCheckedChange={onEnabledChange}
            />
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            type="button"
            title={t('maas.profile.actions')}
            aria-label={t('maas.profile.actions')}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border disabled:pointer-events-none disabled:opacity-50"
          >
            {disconnectMutation.isPending || duplicateMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Ellipsis className="size-3.5" />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              onClick={() => void rpc.app.openExternal(connection.websiteUrl ?? platform.docsUrl)}
            >
              <ExternalLink className="size-3.5" />
              {t('maas.connection.openDocs')}
            </DropdownMenuItem>
            {connection.connected ? (
              <DropdownMenuItem disabled={duplicateMutation.isPending} onClick={handleDuplicate}>
                <Copy className="size-3.5" />
                {t('maas.profile.duplicate')}
              </DropdownMenuItem>
            ) : null}
            {templateId === 'zenmux' && onOpenUsage ? (
              <DropdownMenuItem onClick={onOpenUsage}>
                <Activity className="size-3.5" />
                {t('maas.records.viewUsage')}
              </DropdownMenuItem>
            ) : null}
            {onCancelDraft || connection.connected ? <DropdownMenuSeparator /> : null}
            {onCancelDraft ? (
              <DropdownMenuItem onClick={onCancelDraft}>
                <X className="size-3.5" />
                {t('maas.cancelAddPlatform', { platform: connection.displayName })}
              </DropdownMenuItem>
            ) : null}
            {connection.connected ? (
              <DropdownMenuItem
                variant="destructive"
                disabled={disconnectMutation.isPending}
                onClick={handleDisconnect}
              >
                <Trash2 className="size-3.5" />
                {t('maas.connection.disconnect')}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </AccordionPrimitive.Header>
      <AccordionPrimitive.Content
        className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
        style={
          {
            '--accordion-panel-height': 'var(--radix-accordion-content-height)',
          } as React.CSSProperties
        }
      >
        <ConnectionPanel
          key={`${connection.platformId}:${connection.keyFingerprint ?? 'empty'}:${connection.accountKeyFingerprint ?? 'no-account'}`}
          connection={connection}
          onConnected={onConnected}
          formId={formId}
          onEditorStateChange={setEditorState}
          className="border-t border-border/45"
        />
      </AccordionPrimitive.Content>
    </AccordionPrimitive.Item>
  );
};

const MAAS_PROFILE_GUTTER = <span aria-hidden="true" className="size-6 shrink-0" />;

const SortablePlatformAccordionItem: React.FC<
  PlatformAccordionItemProps & { disabled: boolean }
> = ({ disabled, ...itemProps }) => {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: itemProps.connection.platformId, disabled });
  const label = t('maas.profile.reorder', { name: itemProps.connection.displayName });

  return (
    <PlatformAccordionItem
      {...itemProps}
      itemRef={setNodeRef}
      itemStyle={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.45 : 1,
        position: isDragging ? 'relative' : undefined,
        zIndex: isDragging ? 1 : undefined,
      }}
      dragHandle={
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="flex size-6 shrink-0 touch-none cursor-grab items-center justify-center rounded-md text-foreground-passive opacity-0 outline-none transition-[color,background-color,opacity] hover:bg-foreground/5 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-border active:cursor-grabbing disabled:cursor-not-allowed group-hover/maas-profiles:opacity-100"
          aria-label={label}
          title={label}
          disabled={disabled}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" />
        </button>
      }
    />
  );
};

const StoredSecretField: React.FC<{
  value: string;
  fingerprint: string | null;
  placeholder: string;
  replacing: boolean;
  copying: boolean;
  onValueChange: (value: string) => void;
  onCopy: () => void;
  onReplace: () => void;
  onCancelReplace: () => void;
  storedActions?: React.ReactNode;
}> = ({
  value,
  fingerprint,
  placeholder,
  replacing,
  copying,
  onValueChange,
  onCopy,
  onReplace,
  onCancelReplace,
  storedActions,
}) => {
  const { t } = useTranslation();
  const hasStoredKey = !!fingerprint;
  const showingInput = !hasStoredKey || replacing;

  if (showingInput) {
    return (
      <InputGroup className="h-8">
        <InputGroupInput
          type="password"
          value={value}
          autoComplete="new-password"
          placeholder={placeholder}
          onChange={(event) => onValueChange(event.target.value)}
        />
        {hasStoredKey ? (
          <InputGroupAddon align="inline-end" className="gap-1 pr-1">
            <Tooltip>
              <TooltipTrigger
                render={
                  <InputGroupButton
                    type="button"
                    size="icon-xs"
                    aria-label={t('maas.connection.cancelReplaceKey')}
                    onClick={onCancelReplace}
                  >
                    <X className="h-3.5 w-3.5" />
                  </InputGroupButton>
                }
              />
              <TooltipContent>{t('maas.connection.cancelReplaceKey')}</TooltipContent>
            </Tooltip>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    );
  }

  return (
    <InputGroup className="h-8">
      <InputGroupInput
        readOnly
        value={formatMaskedApiKey(fingerprint)}
        className="cursor-pointer font-mono"
        aria-label={t('maas.connection.storedKeyAriaLabel')}
        onClick={onCopy}
      />
      <InputGroupAddon align="inline-end" className="gap-1 pr-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <InputGroupButton
                type="button"
                size="icon-xs"
                disabled={copying}
                aria-label={t('maas.connection.copyKey')}
                onClick={onCopy}
              >
                {copying ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </InputGroupButton>
            }
          />
          <TooltipContent>{t('maas.connection.copyKey')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <InputGroupButton
                type="button"
                size="icon-xs"
                aria-label={t('maas.connection.replaceKey')}
                onClick={onReplace}
              >
                <Pencil className="h-3.5 w-3.5" />
              </InputGroupButton>
            }
          />
          <TooltipContent>{t('maas.connection.replaceKey')}</TooltipContent>
        </Tooltip>
        {storedActions}
      </InputGroupAddon>
    </InputGroup>
  );
};

const ConnectionPanel: React.FC<{
  connection: MaasConnection;
  onConnected: () => void;
  formId: string;
  onEditorStateChange: (state: ConnectionEditorState) => void;
  className?: string;
}> = ({ connection, onConnected, formId, onEditorStateChange, className }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const connectMutation = useConnectMaasPlatform();
  const templateId = getMaasPlatformTemplateId(connection.platformId);
  const isZenmux = templateId === 'zenmux';
  const supportsAccountUsageCredential = !isZenmux && templateId !== 'openrouter';
  const [apiKey, setApiKey] = useState('');
  const [inferenceApiKey, setInferenceApiKey] = useState('');
  const [accountAccessToken, setAccountAccessToken] = useState('');
  const [replacingKey, setReplacingKey] = useState(!connection.connected);
  const [replacingInferenceKey, setReplacingInferenceKey] = useState(false);
  const [replacingAccountKey, setReplacingAccountKey] = useState(false);
  const [copyingKeyKind, setCopyingKeyKind] = useState<MaasApiKeyKind | null>(null);
  const [displayName, setDisplayName] = useState(connection.displayName);
  const [endpoint, setEndpoint] = useState(connection.endpoint);
  const generatedEnvKey = resolveMaasEnvKey(connection.platformId, connection.displayName);
  const legacyDefaultEnvKey = resolveMaasEnvKey(connection.platformId);
  const hasCustomEnvKey = Boolean(
    connection.envKey &&
      connection.envKey !== generatedEnvKey &&
      connection.envKey !== legacyDefaultEnvKey
  );
  const [envKey, setEnvKey] = useState(
    hasCustomEnvKey ? (connection.envKey ?? generatedEnvKey) : generatedEnvKey
  );
  const [envKeyEdited, setEnvKeyEdited] = useState(hasCustomEnvKey);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const saving = connectMutation.isPending;
  const hasStoredClientKey =
    connection.connected &&
    Boolean(isZenmux ? connection.inferenceKeyFingerprint : connection.keyFingerprint);
  const clientKey = isZenmux ? inferenceApiKey : apiKey;
  const replacingClientKey = isZenmux ? replacingInferenceKey : replacingKey;
  const hasClientKey = Boolean(clientKey.trim() || (hasStoredClientKey && !replacingClientKey));
  const basicConfigurationComplete = Boolean(displayName.trim() && endpoint.trim() && hasClientKey);
  const savedEnvKey = connection.envKey ?? generatedEnvKey;
  const hasUnsavedChanges = Boolean(
    displayName.trim() !== connection.displayName.trim() ||
      endpoint.trim() !== connection.endpoint.trim() ||
      clientKey.trim() ||
      replacingClientKey ||
      envKey.trim() !== savedEnvKey ||
      (isZenmux && (apiKey.trim() || replacingKey)) ||
      (supportsAccountUsageCredential && (accountAccessToken.trim() || replacingAccountKey))
  );
  const canSave = basicConfigurationComplete && isValidMaasEnvKey(envKey.trim());
  const clientApiKeyPlaceholder = isZenmux
    ? t('maas.connection.inferenceApiKeyPlaceholder')
    : templateId === 'litellm'
      ? t('maas.connection.litellmKeyPlaceholder')
      : templateId === 'newapi'
        ? t('maas.connection.newApiKeyPlaceholder')
        : templateId === 'cliproxyapi'
          ? t('maas.connection.cliProxyApiKeyPlaceholder')
          : t('maas.connection.apiKeyPlaceholder');
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!displayName.trim() || !endpoint.trim()) {
      setFormError(t('maas.connection.basicFieldsRequired'));
      return;
    }
    if (!clientKey.trim() && (!hasStoredClientKey || replacingClientKey)) {
      setFormError(t('maas.connection.apiKeyRequired'));
      return;
    }
    if (!isValidMaasEnvKey(envKey.trim())) {
      setFormError(t('maas.connection.envKeyInvalid'));
      return;
    }

    setFormError(null);
    connectMutation.mutate(
      {
        platformId: connection.platformId,
        apiKey: apiKey.trim() || undefined,
        inferenceApiKey: inferenceApiKey.trim() || undefined,
        accountAccessToken: accountAccessToken.trim() || undefined,
        displayName,
        endpoint,
        websiteUrl: connection.websiteUrl,
        description: connection.description,
        logoUrl: connection.logoUrl,
        envKey: envKey.trim(),
      },
      {
        onSuccess: () => {
          onConnected();
          setApiKey('');
          setInferenceApiKey('');
          setAccountAccessToken('');
          setReplacingKey(false);
          setReplacingInferenceKey(false);
          setReplacingAccountKey(false);
        },
        onError: (error) => setFormError(error instanceof Error ? error.message : String(error)),
      }
    );
  };

  useEffect(() => {
    onEditorStateChange({ dirty: hasUnsavedChanges, canSave, saving });
  }, [canSave, hasUnsavedChanges, onEditorStateChange, saving]);

  useEffect(
    () => () => {
      onEditorStateChange(EMPTY_CONNECTION_EDITOR_STATE);
    },
    [onEditorStateChange]
  );

  const handleCopyStoredKey = (kind: MaasApiKeyKind) => {
    setFormError(null);
    setCopyingKeyKind(kind);
    void rpc.maas
      .copyStoredApiKey({ platformId: connection.platformId, kind })
      .then((result) => {
        if (result.success) {
          toast({ title: t('maas.connection.copyKeySuccess') });
          return;
        }
        const message = result.error ?? t('maas.connection.copyKeyFailed');
        setFormError(message);
        toast({
          title: t('maas.connection.copyKeyFailed'),
          description: message,
          variant: 'destructive',
        });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setFormError(message);
        toast({
          title: t('maas.connection.copyKeyFailed'),
          description: message,
          variant: 'destructive',
        });
      })
      .finally(() => setCopyingKeyKind(null));
  };

  const handleReplaceKey = () => {
    setFormError(null);
    setApiKey('');
    setReplacingKey(true);
  };

  const handleCancelReplaceKey = () => {
    setFormError(null);
    setApiKey('');
    setReplacingKey(false);
  };

  const handleReplaceInferenceKey = () => {
    setFormError(null);
    setInferenceApiKey('');
    setReplacingInferenceKey(true);
  };

  const handleCancelReplaceInferenceKey = () => {
    setFormError(null);
    setInferenceApiKey('');
    setReplacingInferenceKey(false);
  };

  const handleReplaceAccountKey = () => {
    setFormError(null);
    setAccountAccessToken('');
    setReplacingAccountKey(true);
  };

  const handleCancelReplaceAccountKey = () => {
    setFormError(null);
    setAccountAccessToken('');
    setReplacingAccountKey(false);
  };

  const clientKeyKind: MaasApiKeyKind = isZenmux ? 'inference' : 'primary';
  const clientKeyFingerprint = isZenmux
    ? connection.inferenceKeyFingerprint
    : connection.keyFingerprint;
  return (
    <section className={cn('@container bg-background-secondary/15 px-4 py-4', className)}>
      <form id={formId} onSubmit={handleSubmit} className="grid gap-4">
        <div
          data-testid="maas-basic-settings"
          className="grid gap-4 rounded-xl border border-border/55 bg-background-1/70 px-3.5 py-3.5 shadow-[0_1px_1px_rgba(0,0,0,0.025)] @3xl:grid-cols-2"
        >
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t('maas.connection.displayName')}
            </span>
            <Input
              value={displayName}
              onChange={(event) => {
                const nextDisplayName = event.target.value;
                setDisplayName(nextDisplayName);
                if (!envKeyEdited) {
                  setEnvKey(resolveMaasEnvKey(connection.platformId, nextDisplayName));
                }
              }}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t('maas.connection.endpoint')}
            </span>
            <Input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} />
          </label>
          <label className="grid gap-1.5 @3xl:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t('maas.connection.clientApiKey')}
            </span>
            <StoredSecretField
              value={clientKey}
              fingerprint={clientKeyFingerprint}
              placeholder={clientApiKeyPlaceholder}
              replacing={replacingClientKey}
              copying={copyingKeyKind === clientKeyKind}
              onValueChange={isZenmux ? setInferenceApiKey : setApiKey}
              onCopy={() => handleCopyStoredKey(clientKeyKind)}
              onReplace={isZenmux ? handleReplaceInferenceKey : handleReplaceKey}
              onCancelReplace={isZenmux ? handleCancelReplaceInferenceKey : handleCancelReplaceKey}
            />
          </label>
        </div>

        <Collapsible
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
          data-testid="maas-advanced-section"
          className="overflow-hidden rounded-xl border border-border/55 bg-background-1/45 transition-colors data-[panel-open]:bg-background-1/65"
        >
          <CollapsibleTrigger
            type="button"
            className="group flex w-full items-center justify-between gap-4 px-3.5 py-3 text-left outline-none transition-colors hover:bg-foreground/[0.025] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border"
          >
            <span className="min-w-0">
              <span className="block text-xs font-medium text-foreground">
                {t('maas.connection.advanced')}
              </span>
              <span
                className="mt-0.5 block [overflow-wrap:anywhere] text-[11px] leading-relaxed text-foreground-muted"
                style={{ overflowWrap: 'anywhere' }}
              >
                {t(
                  isZenmux
                    ? 'maas.connection.advancedSummaryWithManagement'
                    : supportsAccountUsageCredential
                      ? 'maas.connection.advancedSummaryWithAccountUsage'
                      : 'maas.connection.advancedSummary'
                )}
              </span>
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-foreground-muted transition-transform duration-200 group-data-[panel-open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div data-testid="maas-advanced-settings" className="border-t border-border/50">
              <div className="grid gap-4 px-3.5 py-3.5 @3xl:grid-cols-2">
                <label className="grid gap-1.5 @3xl:col-span-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t('maas.connection.envKey')}
                  </span>
                  <Input
                    value={envKey}
                    spellCheck={false}
                    onChange={(event) => {
                      setEnvKeyEdited(true);
                      setEnvKey(event.target.value);
                    }}
                  />
                </label>
                {isZenmux ? (
                  <label className="grid gap-1.5 @3xl:col-span-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {t('maas.connection.managementApiKey')}
                    </span>
                    <StoredSecretField
                      value={apiKey}
                      fingerprint={connection.keyFingerprint}
                      placeholder={t('maas.connection.zenmuxManagementKeyPlaceholder')}
                      replacing={replacingKey}
                      copying={copyingKeyKind === 'primary'}
                      onValueChange={setApiKey}
                      onCopy={() => handleCopyStoredKey('primary')}
                      onReplace={handleReplaceKey}
                      onCancelReplace={handleCancelReplaceKey}
                    />
                  </label>
                ) : null}
                {supportsAccountUsageCredential ? (
                  <label className="grid gap-1.5 @3xl:col-span-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {t('maas.connection.accountUsageCredential')}
                    </span>
                    <StoredSecretField
                      value={accountAccessToken}
                      fingerprint={connection.accountKeyFingerprint ?? null}
                      placeholder={t('maas.connection.accountUsageCredentialPlaceholder')}
                      replacing={replacingAccountKey}
                      copying={copyingKeyKind === 'account'}
                      onValueChange={setAccountAccessToken}
                      onCopy={() => handleCopyStoredKey('account')}
                      onReplace={handleReplaceAccountKey}
                      onCancelReplace={handleCancelReplaceAccountKey}
                    />
                    <span className="text-[11px] leading-relaxed text-foreground-muted">
                      {t('maas.connection.accountUsageCredentialHelper')}
                    </span>
                  </label>
                ) : null}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {formError ? <p className="text-xs text-destructive">{formError}</p> : null}
      </form>
    </section>
  );
};
