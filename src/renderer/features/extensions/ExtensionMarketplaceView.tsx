import {
  BadgeCheck,
  KeyRound,
  Loader2,
  Network,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Store,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { YodaExtensionCapability, YodaMarketplaceExtension } from '@shared/extensions';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import { Input } from '@renderer/lib/ui/input';
import { Switch } from '@renderer/lib/ui/switch';
import { cn } from '@renderer/utils/utils';
import { useExtensionMarketplace } from './useExtensionMarketplace';

const CAPABILITY_ICONS: Partial<Record<YodaExtensionCapability, typeof Network>> = {
  'network.loopback': Server,
  'network.outbound': Network,
  'secrets.provider': KeyRound,
  'client.codex.configure': ShieldCheck,
  'autostart.yoda': RefreshCw,
};

function ExtensionCard({
  extension,
  pending,
  onInstall,
  onSetEnabled,
  onUninstall,
}: {
  extension: YodaMarketplaceExtension;
  pending: boolean;
  onInstall: (extension: YodaMarketplaceExtension) => void;
  onSetEnabled: (extensionId: string, enabled: boolean) => void;
  onUninstall: (extensionId: string) => void;
}) {
  const { t } = useTranslation();
  const { manifest, installation, runtime, supported } = extension;
  const running = runtime?.state === 'running';

  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Store className="size-4 shrink-0 text-muted-foreground" />
            <h2 className="truncate font-medium">{manifest.name}</h2>
            <span className="text-xs text-muted-foreground">v{manifest.version}</span>
            {manifest.publisher.verified && (
              <Badge variant="secondary" className="gap-1">
                <BadgeCheck className="size-3" />
                {t('extensions.verified')}
              </Badge>
            )}
            {installation && (
              <Badge variant={running ? 'default' : 'secondary'}>
                {running ? t('extensions.running') : t('extensions.installed')}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {manifest.publisher.name} · {manifest.id}
          </p>
        </div>

        {installation && (
          <Switch
            checked={installation.enabled}
            disabled={pending}
            onCheckedChange={(enabled) => onSetEnabled(manifest.id, enabled)}
            aria-label={t('extensions.toggleAria', { name: manifest.name })}
          />
        )}
      </div>

      <p className="mt-3 text-sm text-muted-foreground">{manifest.description}</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {manifest.capabilities.map((capability) => {
          const Icon = CAPABILITY_ICONS[capability] ?? ShieldCheck;
          return (
            <span
              key={capability}
              className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
            >
              <Icon className="size-3" />
              {t(`extensions.capabilities.${capability}`)}
            </span>
          );
        })}
      </div>

      {runtime?.error && (
        <p className="mt-3 rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
          {runtime.error}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3">
        <span className="text-xs text-muted-foreground">
          {runtime?.endpoint
            ? t('extensions.localEndpoint', { endpoint: runtime.endpoint })
            : t('extensions.backgroundService')}
        </span>

        {!installation ? (
          <Button size="sm" disabled={!supported || pending} onClick={() => onInstall(extension)}>
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            {supported ? t('extensions.install') : t('extensions.unsupported')}
          </Button>
        ) : (
          <ConfirmButton
            variant="ghost"
            size="sm"
            disabled={pending}
            className="text-destructive hover:text-destructive"
            onClick={() => onUninstall(manifest.id)}
          >
            {t('extensions.uninstall')}
          </ConfirmButton>
        )}
      </div>
    </article>
  );
}

export function ExtensionMarketplaceView() {
  const { t } = useTranslation();
  const {
    extensions,
    isLoading,
    isRefreshing,
    pendingExtensionId,
    searchQuery,
    setSearchQuery,
    refresh,
    install,
    setEnabled,
    uninstall,
  } = useExtensionMarketplace();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="@container flex h-full flex-col overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-4xl px-8 py-8">
        <div className="mb-6">
          <h1 className="text-lg font-semibold">{t('extensions.title')}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{t('extensions.subtitle')}</p>
        </div>

        <div className="sticky top-0 z-20 -mx-8 mb-6 flex items-center gap-2 border-b border-border/60 bg-background/95 px-8 py-2 backdrop-blur">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('extensions.searchPlaceholder')}
              className="pl-9"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void refresh()}
            aria-label={t('extensions.refreshAria')}
          >
            <RefreshCw
              className={cn('size-4 text-muted-foreground', isRefreshing && 'animate-spin')}
            />
          </Button>
        </div>

        {extensions.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-2">
            {extensions.map((extension) => (
              <ExtensionCard
                key={extension.manifest.id}
                extension={extension}
                pending={pendingExtensionId === extension.manifest.id}
                onInstall={install}
                onSetEnabled={setEnabled}
                onUninstall={uninstall}
              />
            ))}
          </div>
        ) : (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {t('extensions.noMatches')}
          </p>
        )}
      </div>
    </div>
  );
}
