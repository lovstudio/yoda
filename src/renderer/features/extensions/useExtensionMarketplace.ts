import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { YodaMarketplaceExtension } from '@shared/extensions';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';

const MARKETPLACE_QUERY_KEY = ['extensions', 'marketplace'] as const;

export function useExtensionMarketplace() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');

  const query = useQuery({
    queryKey: MARKETPLACE_QUERY_KEY,
    queryFn: () => rpc.extensions.listMarketplace(),
  });

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: MARKETPLACE_QUERY_KEY }),
    [queryClient]
  );

  const installMutation = useMutation({
    mutationFn: async (extension: YodaMarketplaceExtension) => {
      const result = await rpc.extensions.install({
        extensionId: extension.manifest.id,
        grantedCapabilities: extension.manifest.capabilities,
      });
      if (!result.success) throw new Error(result.error ?? t('extensions.errors.install'));
      return result.extension;
    },
    onSuccess: () => void refresh(),
    onError: (error) =>
      toast({
        title: t('extensions.errors.install'),
        description: error.message,
        variant: 'destructive',
      }),
  });

  const setEnabledMutation = useMutation({
    mutationFn: async ({ extensionId, enabled }: { extensionId: string; enabled: boolean }) => {
      const result = await rpc.extensions.setEnabled({ extensionId, enabled });
      if (!result.success) throw new Error(result.error ?? t('extensions.errors.update'));
    },
    onSuccess: () => void refresh(),
    onError: (error) =>
      toast({
        title: t('extensions.errors.update'),
        description: error.message,
        variant: 'destructive',
      }),
  });

  const uninstallMutation = useMutation({
    mutationFn: async (extensionId: string) => {
      const result = await rpc.extensions.uninstall({ extensionId });
      if (!result.success) throw new Error(result.error ?? t('extensions.errors.remove'));
    },
    onSuccess: () => void refresh(),
    onError: (error) =>
      toast({
        title: t('extensions.errors.remove'),
        description: error.message,
        variant: 'destructive',
      }),
  });

  const extensions = useMemo(() => {
    const all = query.data ?? [];
    const normalized = searchQuery.trim().toLowerCase();
    if (!normalized) return all;
    return all.filter((extension) => {
      const { manifest } = extension;
      return [manifest.name, manifest.id, manifest.description, manifest.publisher.name].some(
        (value) => value.toLowerCase().includes(normalized)
      );
    });
  }, [query.data, searchQuery]);

  return {
    extensions,
    isLoading: query.isPending,
    isRefreshing: query.isFetching,
    pendingExtensionId:
      installMutation.variables?.manifest.id ??
      setEnabledMutation.variables?.extensionId ??
      uninstallMutation.variables ??
      null,
    searchQuery,
    setSearchQuery,
    refresh,
    install: (extension: YodaMarketplaceExtension) => installMutation.mutate(extension),
    setEnabled: (extensionId: string, enabled: boolean) =>
      setEnabledMutation.mutate({ extensionId, enabled }),
    uninstall: (extensionId: string) => uninstallMutation.mutate(extensionId),
  };
}
