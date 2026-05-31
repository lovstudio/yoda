import { Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalContext, useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { cn } from '@renderer/utils/utils';
import { McpCard } from './McpCard';
import type { McpModalMode } from './McpModal';
import { useMcps } from './useMcps';

export const McpView: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { t } = useTranslation();
  const {
    installed,
    catalog,
    providers,
    isLoading,
    isRefreshing,
    saveServer,
    removeServer,
    refresh,
  } = useMcps();

  const { showModal, closeModal } = useModalContext();
  const showConfirm = useShowModal('confirmActionModal');
  const [search, setSearch] = useState('');

  const handleRemoveRequest = (serverName: string) => {
    closeModal();
    showConfirm({
      title: t('mcp.removeServerTitle'),
      description: t('mcp.removeServerDescription', { name: serverName }),
      confirmLabel: t('mcp.removeServerConfirm'),
      onSuccess: () => void removeServer(serverName),
    });
  };

  const openModal = (mode: McpModalMode) => {
    const source =
      mode.type === 'add-catalog' ? 'catalog' : mode.type === 'add-custom' ? 'custom' : null;
    showModal('mcpServerModal', {
      mode,
      providers,
      onSave: (server) => saveServer(server, source),
      onRemove: handleRemoveRequest,
    });
  };

  // Filter
  const lowerSearch = search.toLowerCase();
  const installedNames = new Set(installed.map((s) => s.name));
  const filteredInstalled = installed.filter(
    (s) => !search || s.name.toLowerCase().includes(lowerSearch)
  );
  const filteredCatalog = catalog.filter(
    (c) =>
      !installedNames.has(c.key) &&
      (!search ||
        c.name.toLowerCase().includes(lowerSearch) ||
        c.description.toLowerCase().includes(lowerSearch))
  );

  if (isLoading) {
    return (
      <div
        className={cn(
          'flex items-center justify-center bg-background text-foreground',
          embedded ? 'h-48' : 'h-full'
        )}
      >
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col bg-background text-foreground',
        embedded ? 'w-full' : 'h-full overflow-y-auto'
      )}
    >
      <div className={cn('w-full', !embedded && 'mx-auto max-w-3xl px-8 py-8')}>
        {/* Header */}
        {!embedded && (
          <div className="mb-6">
            <h1 className="text-lg font-semibold">{t('mcp.title')}</h1>
            <p className="mt-1 text-xs text-muted-foreground">{t('mcp.subtitle')}</p>
          </div>
        )}

        {/* Toolbar */}
        <div className="mb-6 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('mcp.searchPlaceholder')}
              className="pl-9"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            disabled={isRefreshing}
            aria-label={t('mcp.refreshAria')}
          >
            <RefreshCw
              className={`h-4 w-4 text-muted-foreground ${isRefreshing ? 'animate-spin' : ''}`}
            />
          </Button>
          <Button variant="outline" size="sm" onClick={() => openModal({ type: 'add-custom' })}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t('mcp.customMcp')}
          </Button>
        </div>

        {/* Installed */}
        {filteredInstalled.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">
              {t('mcp.added')}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {filteredInstalled.map((server) => (
                <McpCard
                  key={server.name}
                  server={server}
                  catalogEntry={catalog.find((c) => c.key === server.name)}
                  onEdit={(s) => openModal({ type: 'edit', server: s })}
                />
              ))}
            </div>
          </div>
        )}

        {/* Recommended */}
        {filteredCatalog.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">
              {t('mcp.recommended')}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {filteredCatalog.map((entry) => (
                <McpCard
                  key={entry.key}
                  catalogEntry={entry}
                  onEdit={() => {}}
                  onAdd={(e) => openModal({ type: 'add-catalog', entry: e })}
                />
              ))}
            </div>
          </div>
        )}

        {filteredInstalled.length === 0 && filteredCatalog.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {search ? t('mcp.noMatches') : t('mcp.noServers')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
