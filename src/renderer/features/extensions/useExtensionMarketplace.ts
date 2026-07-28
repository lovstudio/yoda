import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { YodaMarketplaceExtension } from '@shared/extensions';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import {
  EXTENSION_MARKETPLACE_QUERY_KEY,
  listMarketplaceExtensions,
} from './extension-marketplace-query';

function replaceMarketplaceExtension(
  extensions: YodaMarketplaceExtension[] | undefined,
  extension: YodaMarketplaceExtension
): YodaMarketplaceExtension[] | undefined {
  return extensions?.map((candidate) =>
    candidate.manifest.id === extension.manifest.id ? extension : candidate
  );
}

export function useExtensionMarketplace() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');

  const query = useQuery({
    queryKey: EXTENSION_MARKETPLACE_QUERY_KEY,
    queryFn: listMarketplaceExtensions,
  });

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: EXTENSION_MARKETPLACE_QUERY_KEY }),
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
    onSuccess: (extension) => {
      if (!extension) return void refresh();
      queryClient.setQueryData<YodaMarketplaceExtension[]>(
        EXTENSION_MARKETPLACE_QUERY_KEY,
        (extensions) => replaceMarketplaceExtension(extensions, extension)
      );
    },
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
      if (!result.success || !result.extension) {
        throw new Error(result.error ?? t('extensions.errors.update'));
      }
      return result.extension;
    },
    onMutate: async ({ extensionId, enabled }) => {
      await queryClient.cancelQueries({
        queryKey: EXTENSION_MARKETPLACE_QUERY_KEY,
        exact: true,
      });
      const previousExtensions = queryClient.getQueryData<YodaMarketplaceExtension[]>(
        EXTENSION_MARKETPLACE_QUERY_KEY
      );
      queryClient.setQueryData<YodaMarketplaceExtension[]>(
        EXTENSION_MARKETPLACE_QUERY_KEY,
        (extensions) =>
          extensions?.map((extension) =>
            extension.manifest.id === extensionId && extension.installation
              ? {
                  ...extension,
                  installation: {
                    ...extension.installation,
                    enabled,
                  },
                }
              : extension
          )
      );
      return { previousExtensions };
    },
    onSuccess: (extension) => {
      queryClient.setQueryData<YodaMarketplaceExtension[]>(
        EXTENSION_MARKETPLACE_QUERY_KEY,
        (extensions) => replaceMarketplaceExtension(extensions, extension)
      );
    },
    onError: (error, _variables, context) => {
      if (context?.previousExtensions) {
        queryClient.setQueryData(EXTENSION_MARKETPLACE_QUERY_KEY, context.previousExtensions);
      }
      toast({
        title: t('extensions.errors.update'),
        description: error.message,
        variant: 'destructive',
      });
    },
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
      (installMutation.isPending ? installMutation.variables?.manifest.id : undefined) ??
      (setEnabledMutation.isPending ? setEnabledMutation.variables?.extensionId : undefined) ??
      (uninstallMutation.isPending ? uninstallMutation.variables : undefined) ??
      null,
    pendingEnabledChange: setEnabledMutation.isPending
      ? (setEnabledMutation.variables ?? null)
      : null,
    searchQuery,
    setSearchQuery,
    refresh,
    install: (extension: YodaMarketplaceExtension) => installMutation.mutate(extension),
    setEnabled: (extensionId: string, enabled: boolean) =>
      setEnabledMutation.mutate({ extensionId, enabled }),
    uninstall: (extensionId: string) => uninstallMutation.mutate(extensionId),
  };
}
