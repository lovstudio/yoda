import {
  Bot,
  Boxes,
  Loader2,
  Puzzle,
  RefreshCw,
  Search,
  Terminal,
  Webhook,
  Wrench,
} from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { InstalledPlugin } from '@shared/plugins/types';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import { Input } from '@renderer/lib/ui/input';
import { Switch } from '@renderer/lib/ui/switch';
import { cn } from '@renderer/utils/utils';
import { usePlugins } from './usePlugins';

const COMPONENT_META = [
  { key: 'skills', icon: Boxes, labelKey: 'plugins.components.skills' },
  { key: 'commands', icon: Terminal, labelKey: 'plugins.components.commands' },
  { key: 'agents', icon: Bot, labelKey: 'plugins.components.agents' },
  { key: 'hooks', icon: Webhook, labelKey: 'plugins.components.hooks' },
  { key: 'mcpServers', icon: Wrench, labelKey: 'plugins.components.mcpServers' },
] as const;

const PluginCard: React.FC<{
  plugin: InstalledPlugin;
  onSetEnabled: (id: string, enabled: boolean) => void;
  onUninstall: (id: string) => void;
}> = ({ plugin, onSetEnabled, onUninstall }) => {
  const { t } = useTranslation();
  const chips = COMPONENT_META.filter(({ key }) => plugin.components[key] > 0);

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card p-4 transition-opacity',
        !plugin.enabled && 'opacity-60'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Puzzle className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{plugin.name}</span>
            {plugin.version && (
              <span className="shrink-0 text-xs text-muted-foreground">{plugin.version}</span>
            )}
            {!plugin.enabled && (
              <Badge variant="secondary" className="shrink-0">
                {t('plugins.disabled')}
              </Badge>
            )}
          </div>
          {plugin.marketplace && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{plugin.marketplace}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Switch
            checked={plugin.enabled}
            onCheckedChange={(checked) => onSetEnabled(plugin.id, checked)}
            aria-label={t('plugins.toggleAria', { name: plugin.name })}
          />
        </div>
      </div>

      {plugin.description && (
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{plugin.description}</p>
      )}

      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map(({ key, icon: Icon, labelKey }) => (
            <span
              key={key}
              className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
              title={t(labelKey)}
            >
              <Icon className="h-3 w-3" />
              {plugin.components[key]}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-end border-t border-border/60 pt-3">
        <ConfirmButton
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => onUninstall(plugin.id)}
        >
          {t('plugins.uninstall')}
        </ConfirmButton>
      </div>
    </div>
  );
};

const PluginsView: React.FC<{ surfaceControl?: React.ReactNode }> = ({ surfaceControl }) => {
  const { t } = useTranslation();
  const {
    plugins,
    isLoading,
    isRefreshing,
    searchQuery,
    setSearchQuery,
    refresh,
    setEnabled,
    uninstall,
  } = usePlugins();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="@container flex h-full flex-col overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-8 py-8">
        <div className="mb-6">
          {surfaceControl ?? <h1 className="text-lg font-semibold">{t('plugins.title')}</h1>}
          <p className="mt-1 text-xs text-muted-foreground">{t('plugins.subtitle')}</p>
        </div>

        <div className="sticky top-0 z-20 -mx-8 mb-6 flex items-center gap-2 border-b border-border/60 bg-background/95 px-8 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t('plugins.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            disabled={isRefreshing}
            aria-label={t('plugins.refreshAria')}
          >
            <RefreshCw
              className={cn('h-4 w-4 text-muted-foreground', isRefreshing && 'animate-spin')}
            />
          </Button>
        </div>

        {plugins.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
            {plugins.map((plugin) => (
              <PluginCard
                key={plugin.id}
                plugin={plugin}
                onSetEnabled={setEnabled}
                onUninstall={uninstall}
              />
            ))}
          </div>
        ) : (
          <div className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {searchQuery ? t('plugins.noMatches') : t('plugins.noPlugins')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PluginsView;
