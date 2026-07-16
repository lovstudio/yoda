import * as AccordionPrimitive from '@radix-ui/react-accordion';
import {
  Activity,
  ChevronDown,
  Copy,
  ExternalLink,
  Layers,
  Loader2,
  Pencil,
  Plug,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MAAS_PLATFORM_IDS,
  MAAS_PLATFORMS,
  type MaasApiKeyKind,
  type MaasConnection,
  type MaasPlatformId,
  type MaasPlatformOfficialDescription,
} from '@shared/maas';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@renderer/lib/ui/input-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import {
  useConnectMaasPlatform,
  useDisconnectMaasPlatform,
  useMaasConnections,
  useMaasPlatformDescriptions,
} from '../useMaas';
import { MaasGlobalSelector } from './MaasGlobalSelector';

function findConnection(
  connections: MaasConnection[] | undefined,
  platformId: MaasPlatformId
): MaasConnection {
  return (
    connections?.find((connection) => connection.platformId === platformId) ?? {
      platformId,
      displayName: MAAS_PLATFORMS[platformId].name,
      endpoint: MAAS_PLATFORMS[platformId].defaultEndpoint,
      keyFingerprint: null,
      inferenceKeyFingerprint: null,
      connectedAt: null,
      lastCheckedAt: null,
      connected: false,
      error: null,
    }
  );
}

function isMaasPlatformId(value: string): value is MaasPlatformId {
  return (MAAS_PLATFORM_IDS as readonly string[]).includes(value);
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

function formatMaskedApiKey(fingerprint: string | null): string {
  const value = fingerprint?.trim();
  if (!value) return '****';
  if (value.startsWith('...')) return `****${value}`;
  return value;
}

function truncateAuditText(value: string, limit = 360): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 3).trim()}...`;
}

export const MaasConnectedCountBadge: React.FC = () => {
  const { t } = useTranslation();
  const { data: connections } = useMaasConnections();
  const connectedCount = connections?.filter((connection) => connection.connected).length ?? 0;

  return <Badge variant="secondary">{t('maas.connectedCount', { count: connectedCount })}</Badge>;
};

export const MaasView: React.FC<{
  embedded?: boolean;
  showSectionChrome?: boolean;
}> = ({ embedded = false, showSectionChrome = true }) => {
  const { t } = useTranslation();
  const { data: connections, isLoading } = useMaasConnections();
  const { data: platformDescriptions } = useMaasPlatformDescriptions();
  const showZenmuxUsage = useShowModal('zenmuxUsageModal');
  const [expandedPlatformId, setExpandedPlatformId] = useState<MaasPlatformId | ''>('zenmux');
  const connectedCount = connections?.filter((connection) => connection.connected).length ?? 0;
  const platformDescriptionById = useMemo(
    () =>
      new Map(platformDescriptions?.map((description) => [description.platformId, description])),
    [platformDescriptions]
  );

  const handlePlatformValueChange = useCallback((value: string) => {
    if (value === '') {
      setExpandedPlatformId('');
      return;
    }
    if (!isMaasPlatformId(value)) return;
    setExpandedPlatformId(value);
  }, []);

  const platformAccordion = (
    <AccordionPrimitive.Root
      type="single"
      collapsible
      value={expandedPlatformId}
      onValueChange={handlePlatformValueChange}
      className="overflow-hidden rounded-xl border border-border/60 bg-muted/10"
    >
      {MAAS_PLATFORM_IDS.map((platformId) => (
        <PlatformAccordionItem
          key={platformId}
          connection={findConnection(connections, platformId)}
          officialDescription={platformDescriptionById.get(platformId)}
          onOpenUsage={platformId === 'zenmux' ? () => showZenmuxUsage({}) : undefined}
          loading={isLoading}
        />
      ))}
    </AccordionPrimitive.Root>
  );

  const content = (
    <div
      className={cn(
        'flex min-h-0 flex-col gap-8',
        embedded ? 'w-full' : 'mx-auto w-full max-w-5xl px-6 py-6'
      )}
    >
      {showSectionChrome ? (
        <>
          <MaasChapter
            title={t('maas.platformsTitle')}
            action={
              <Badge variant="secondary">
                {t('maas.connectedCount', { count: connectedCount })}
              </Badge>
            }
          >
            {platformAccordion}
          </MaasChapter>
        </>
      ) : (
        platformAccordion
      )}
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

const MaasDescriptionSourceBadge: React.FC<{
  description: MaasPlatformOfficialDescription;
}> = ({ description }) => {
  const { t } = useTranslation();
  const sourceLabel = t(`maas.platformDescription.source.${description.source}`);
  const sourceHint = t(`maas.platformDescription.hint.${description.source}`);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            className={cn(
              'inline-flex h-5 shrink-0 cursor-help items-center rounded border px-1.5 text-[10px] leading-none outline-none transition-colors focus-visible:ring-1 focus-visible:ring-border',
              description.source === 'fallback'
                ? 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            )}
          >
            {sourceLabel}
          </span>
        }
      />
      <TooltipContent className="block max-w-[28rem] text-left leading-relaxed">
        <span className="block font-medium">{sourceHint}</span>
        {description.sourceUrl && (
          <span className="mt-1 block break-all text-foreground-muted">
            {description.sourceUrl}
          </span>
        )}
        {description.metaDescription && (
          <span className="mt-2 block">
            <span className="font-medium">{t('maas.platformDescription.metaLabel')}</span>
            <span className="mt-0.5 block text-foreground-muted">
              {truncateAuditText(description.metaDescription)}
            </span>
          </span>
        )}
        {description.bodySummary && (
          <span className="mt-2 block">
            <span className="font-medium">{t('maas.platformDescription.bodySummaryLabel')}</span>
            <span className="mt-0.5 block text-foreground-muted">
              {truncateAuditText(description.bodySummary)}
            </span>
          </span>
        )}
        {description.bodyTextExcerpt && (
          <span className="mt-2 block">
            <span className="font-medium">
              {t('maas.platformDescription.bodyExcerptLabel', {
                count: description.bodyCharCount ?? description.bodyTextExcerpt.length,
              })}
            </span>
            <span className="mt-0.5 block text-foreground-muted">
              {truncateAuditText(description.bodyTextExcerpt)}
            </span>
          </span>
        )}
        {description.error && (
          <span className="mt-2 block text-destructive">
            {t('maas.platformDescription.errorLabel', { error: description.error })}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
};

const MaasChapter: React.FC<{
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, description, action, children }) => {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h3 className="min-w-0 text-sm font-normal text-foreground">{title}</h3>
        {action && <div className="flex shrink-0 justify-end">{action}</div>}
      </div>
      {description && <p className="text-xs text-foreground-muted">{description}</p>}
      {children}
    </section>
  );
};

const PlatformAccordionItem: React.FC<{
  connection: MaasConnection;
  officialDescription?: MaasPlatformOfficialDescription;
  onOpenUsage?: () => void;
  loading: boolean;
}> = ({ connection, officialDescription, onOpenUsage, loading }) => {
  const { t } = useTranslation();
  const platform = MAAS_PLATFORMS[connection.platformId];
  const statusLabel = connection.connected ? t('maas.connected') : t('maas.notConnected');
  const description =
    officialDescription?.source === 'fallback' || !officialDescription
      ? t(`maas.platforms.${connection.platformId}.description`)
      : officialDescription.description;

  return (
    <AccordionPrimitive.Item
      value={connection.platformId}
      className="border-b border-border/50 transition-colors last:border-b-0 data-[state=open]:bg-background-1/40"
    >
      <AccordionPrimitive.Header className="flex items-center gap-1 pr-2.5">
        <AccordionPrimitive.Trigger className="group flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/30 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border">
          <ChevronDown
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-200 group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-background-secondary">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-sm text-foreground">{platform.name}</span>
          </span>
          <span className="hidden min-w-0 max-w-64 truncate text-xs text-muted-foreground @4xl:block">
            {description}
          </span>
        </AccordionPrimitive.Trigger>
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                role="status"
                tabIndex={0}
                aria-label={statusLabel}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md outline-none transition-colors hover:bg-muted/40 focus-visible:ring-1 focus-visible:ring-border"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-2 w-2 rounded-full',
                    connection.connected ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                    loading && 'animate-pulse'
                  )}
                />
              </span>
            }
          />
          <TooltipContent className="block max-w-64 text-left leading-relaxed">
            <span className="block font-medium">{statusLabel}</span>
            {connection.keyFingerprint && (
              <span className="mt-1 block">
                {t('maas.connection.keyFingerprint', { fingerprint: connection.keyFingerprint })}
              </span>
            )}
            <span className="mt-1 block">
              {connection.lastCheckedAt
                ? t('maas.connection.lastChecked', {
                    time: formatDateTime(connection.lastCheckedAt),
                  })
                : t('maas.connection.neverChecked')}
            </span>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t('maas.connection.openDocs')}
                onClick={() => void rpc.app.openExternal(platform.docsUrl)}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            }
          />
          <TooltipContent>{t('maas.connection.openDocs')}</TooltipContent>
        </Tooltip>
        {connection.platformId === 'zenmux' && onOpenUsage && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('maas.records.viewUsage')}
                  onClick={onOpenUsage}
                >
                  <Activity className="h-3.5 w-3.5" />
                </Button>
              }
            />
            <TooltipContent>{t('maas.records.viewUsage')}</TooltipContent>
          </Tooltip>
        )}
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
          key={`${connection.platformId}:${connection.keyFingerprint ?? 'empty'}`}
          connection={connection}
          officialDescription={officialDescription}
          className="border-t border-border/50"
        />
      </AccordionPrimitive.Content>
    </AccordionPrimitive.Item>
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
      <div className="grid gap-1.5">
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
        {hasStoredKey ? (
          <span className="text-xs leading-relaxed text-foreground-muted">
            {t('maas.connection.replaceKeyEditingHint')}
          </span>
        ) : null}
      </div>
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
  officialDescription?: MaasPlatformOfficialDescription;
  className?: string;
}> = ({ connection, officialDescription, className }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const connectMutation = useConnectMaasPlatform();
  const disconnectMutation = useDisconnectMaasPlatform();
  const [apiKey, setApiKey] = useState('');
  const [inferenceApiKey, setInferenceApiKey] = useState('');
  const [replacingKey, setReplacingKey] = useState(!connection.connected);
  const [replacingInferenceKey, setReplacingInferenceKey] = useState(false);
  const [copyingKeyKind, setCopyingKeyKind] = useState<MaasApiKeyKind | null>(null);
  const [displayName, setDisplayName] = useState(connection.displayName);
  const [endpoint, setEndpoint] = useState(connection.endpoint);
  const [formError, setFormError] = useState<string | null>(null);

  const saving = connectMutation.isPending;
  const disconnecting = disconnectMutation.isPending;
  const hasStoredKey = connection.connected && !!connection.keyFingerprint;
  const hasNewInferenceKey = connection.platformId === 'zenmux' && !!inferenceApiKey.trim();
  const submitDisabled =
    saving ||
    (!apiKey.trim() && !hasNewInferenceKey && (!hasStoredKey || replacingKey)) ||
    (!!connection.inferenceKeyFingerprint && replacingInferenceKey && !hasNewInferenceKey);
  const disconnectLabel = t('maas.connection.disconnect');
  const disconnectHint = t('maas.connection.disconnectHint');
  const keyHelper =
    hasStoredKey && replacingKey
      ? t('maas.connection.savedKeyHelper')
      : hasStoredKey
        ? t('maas.connection.storedKeyHelper')
        : t('maas.connection.newKeyHelper');
  const apiKeyLabel =
    connection.platformId === 'zenmux'
      ? t('maas.connection.managementApiKey')
      : t('maas.connection.apiKey');
  const apiKeyPlaceholder =
    connection.platformId === 'zenmux'
      ? t('maas.connection.zenmuxManagementKeyPlaceholder')
      : t('maas.connection.apiKeyPlaceholder');
  const platformDescription =
    officialDescription?.source === 'fallback' || !officialDescription
      ? t(`maas.platforms.${connection.platformId}.description`)
      : officialDescription.description;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!apiKey.trim() && !hasNewInferenceKey && (!hasStoredKey || replacingKey)) {
      setFormError(t('maas.connection.apiKeyRequired'));
      return;
    }

    setFormError(null);
    connectMutation.mutate(
      {
        platformId: connection.platformId,
        apiKey: apiKey.trim() || undefined,
        inferenceApiKey: inferenceApiKey.trim() || undefined,
        displayName,
        endpoint,
      },
      {
        onSuccess: () => {
          setApiKey('');
          setInferenceApiKey('');
          setReplacingKey(false);
          setReplacingInferenceKey(false);
        },
        onError: (error) => setFormError(error instanceof Error ? error.message : String(error)),
      }
    );
  };

  const handleDisconnect = () => {
    setFormError(null);
    disconnectMutation.mutate(connection.platformId, {
      onError: (error) => setFormError(error instanceof Error ? error.message : String(error)),
    });
  };

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

  return (
    <section className={cn('@container bg-background px-4 py-4', className)}>
      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="flex max-w-2xl flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-relaxed text-muted-foreground">
          <span>{platformDescription}</span>
          {officialDescription && <MaasDescriptionSourceBadge description={officialDescription} />}
        </div>

        <div className="grid gap-3 @3xl:grid-cols-[minmax(10rem,0.9fr)_minmax(16rem,1.4fr)]">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t('maas.connection.displayName')}
            </span>
            <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t('maas.connection.endpoint')}
            </span>
            <Input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} />
          </label>
          <label className="grid gap-1.5 @3xl:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">{apiKeyLabel}</span>
            <StoredSecretField
              value={apiKey}
              fingerprint={connection.keyFingerprint}
              placeholder={apiKeyPlaceholder}
              replacing={replacingKey}
              copying={copyingKeyKind === 'primary'}
              onValueChange={setApiKey}
              onCopy={() => handleCopyStoredKey('primary')}
              onReplace={handleReplaceKey}
              onCancelReplace={handleCancelReplaceKey}
              storedActions={
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <InputGroupButton
                        type="button"
                        size="icon-xs"
                        disabled={disconnecting}
                        aria-label={`${disconnectLabel}: ${disconnectHint}`}
                        onClick={handleDisconnect}
                        className="text-foreground-muted hover:bg-destructive/10 hover:text-destructive"
                      >
                        {disconnecting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </InputGroupButton>
                    }
                  />
                  <TooltipContent className="block w-72 max-w-[calc(100vw-2rem)] text-left leading-relaxed">
                    <span className="block whitespace-nowrap font-medium">{disconnectLabel}</span>
                    <span className="mt-1 block">{disconnectHint}</span>
                  </TooltipContent>
                </Tooltip>
              }
            />
            <span className="text-xs leading-relaxed text-foreground-muted">{keyHelper}</span>
          </label>
          {connection.platformId === 'zenmux' && (
            <label className="grid gap-1.5 @3xl:col-span-2">
              <span className="text-xs font-medium text-muted-foreground">
                {t('maas.connection.inferenceApiKey')}
              </span>
              <StoredSecretField
                value={inferenceApiKey}
                fingerprint={connection.inferenceKeyFingerprint}
                placeholder={t('maas.connection.inferenceApiKeyPlaceholder')}
                replacing={replacingInferenceKey}
                copying={copyingKeyKind === 'inference'}
                onValueChange={setInferenceApiKey}
                onCopy={() => handleCopyStoredKey('inference')}
                onReplace={handleReplaceInferenceKey}
                onCancelReplace={handleCancelReplaceInferenceKey}
              />
              <span className="text-xs leading-relaxed text-foreground-muted">
                {t('maas.connection.inferenceApiKeyHelper')}
              </span>
            </label>
          )}
        </div>

        {formError && <p className="text-xs text-destructive">{formError}</p>}

        <div className="flex flex-col gap-3 border-t border-border/50 pt-3 @3xl:flex-row @3xl:items-center @3xl:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-border/60 bg-background-1 px-2">
              <RefreshCw className="h-3.5 w-3.5" />
              {connection.lastCheckedAt
                ? t('maas.connection.lastChecked', {
                    time: formatDateTime(connection.lastCheckedAt),
                  })
                : t('maas.connection.neverChecked')}
            </span>
          </div>
          <Button type="submit" size="sm" disabled={submitDisabled} className="w-full @3xl:w-auto">
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plug className="h-3.5 w-3.5" />
            )}
            {saving ? t('maas.connection.saving') : t('maas.connection.saveChanges')}
          </Button>
        </div>

        <MaasGlobalSelector platformId={connection.platformId} />
      </form>
    </section>
  );
};
