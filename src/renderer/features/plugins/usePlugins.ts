import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';

const INDEX_QUERY_KEY = ['plugins', 'index'] as const;

export function usePlugins() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');

  const { data: index = null, isPending: isLoading } = useQuery({
    queryKey: INDEX_QUERY_KEY,
    queryFn: async () => {
      const result = await rpc.plugins.getIndex();
      if (result.success && result.data) return result.data;
      throw new Error(result.error ?? 'Failed to load plugins');
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const result = await rpc.plugins.refresh();
      if (result.success && result.data) return result.data;
      throw new Error(result.error ?? 'Failed to refresh plugins');
    },
    onSuccess: (data) => queryClient.setQueryData(INDEX_QUERY_KEY, data),
    onError: (error) => log.error('Failed to refresh plugins:', error),
  });

  const refresh = useCallback(() => refreshMutation.mutate(), [refreshMutation]);

  const setEnabledMutation = useMutation({
    mutationFn: async ({ pluginId, enabled }: { pluginId: string; enabled: boolean }) => {
      const result = await rpc.plugins.setEnabled({ pluginId, enabled });
      if (!result.success) throw new Error(result.error ?? 'Could not update plugin');
      return { pluginId, enabled };
    },
    onError: (error, variables) => {
      toast({
        title: variables.enabled ? 'Enable failed' : 'Disable failed',
        description: error.message,
        variant: 'destructive',
      });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['plugins'] }),
  });

  const setEnabled = useCallback(
    async (pluginId: string, enabled: boolean): Promise<boolean> => {
      try {
        await setEnabledMutation.mutateAsync({ pluginId, enabled });
        return true;
      } catch {
        return false;
      }
    },
    [setEnabledMutation]
  );

  const uninstallMutation = useMutation({
    mutationFn: async (pluginId: string) => {
      const result = await rpc.plugins.uninstall({ pluginId });
      if (!result.success) throw new Error(result.error ?? 'Could not uninstall plugin');
      return pluginId;
    },
    onError: (error) => {
      toast({ title: 'Uninstall failed', description: error.message, variant: 'destructive' });
    },
    onSuccess: (pluginId) => {
      toast({ title: 'Plugin removed', description: `${pluginId} has been uninstalled` });
      void queryClient.invalidateQueries({ queryKey: ['plugins'] });
      // Bundled skills/commands changed too.
      void queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });

  const uninstall = useCallback(
    async (pluginId: string): Promise<boolean> => {
      try {
        await uninstallMutation.mutateAsync(pluginId);
        return true;
      } catch {
        return false;
      }
    },
    [uninstallMutation]
  );

  const plugins = useMemo(() => {
    const all = index?.plugins ?? [];
    const q = searchQuery.toLowerCase().trim();
    if (!q) return all;
    return all.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q)
    );
  }, [index, searchQuery]);

  return {
    plugins,
    isLoading,
    isRefreshing: refreshMutation.isPending,
    searchQuery,
    setSearchQuery,
    refresh,
    setEnabled,
    uninstall,
  };
}
