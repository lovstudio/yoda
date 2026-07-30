import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CatalogIndex } from '@shared/skills/types';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import { captureTelemetry } from '@renderer/utils/telemetryClient';
import { fetchSkillsCatalog, skillsCatalogQueryKey } from '../skills-query';

export function useSkills() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');

  const { data: catalog = null, isPending: isLoading } = useQuery({
    queryKey: skillsCatalogQueryKey,
    queryFn: fetchSkillsCatalog,
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const result = await rpc.skills.refreshCatalog();
      if (result.success && result.data) return result.data;
      throw new Error(result.error ?? 'Failed to refresh catalog');
    },
    onSuccess: (data) => {
      queryClient.setQueryData(skillsCatalogQueryKey, data);
    },
    onError: (error) => {
      log.error('Failed to refresh catalog:', error);
    },
  });

  const refresh = useCallback(() => refreshMutation.mutate(), [refreshMutation]);

  const installMutation = useMutation({
    mutationFn: async (skillKey: string) => {
      const result = await rpc.skills.install({ skillKey });
      if (!result.success) throw new Error(result.error ?? 'Could not install skill');
      return skillKey;
    },
    onError: (error) => {
      toast({
        title: 'Install failed',
        description: error.message,
        variant: 'destructive',
      });
    },
    onSuccess: (skillKey) => {
      const skill = queryClient
        .getQueryData<CatalogIndex>(skillsCatalogQueryKey)
        ?.skills.find((s) => s.key === skillKey);

      captureTelemetry('skill_installed', { source: skill?.source });
      toast({
        title: 'Skill installed',
        description: `${skill?.displayName ?? skillKey} is now available across your agents`,
      });
      // Broad key: refreshes the catalog and any open skill-detail tabs.
      void queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });

  const install = useCallback(
    async (skillKey: string): Promise<boolean> => {
      try {
        await installMutation.mutateAsync(skillKey);
        return true;
      } catch {
        return false;
      }
    },
    [installMutation]
  );

  const uninstallMutation = useMutation({
    mutationFn: async (skillKey: string) => {
      const result = await rpc.skills.uninstall({ skillKey });
      if (!result.success) throw new Error(result.error ?? 'Could not uninstall skill');
      return skillKey;
    },
    onError: (error) => {
      toast({
        title: 'Uninstall failed',
        description: error.message,
        variant: 'destructive',
      });
    },
    onSuccess: () => {
      captureTelemetry('skill_uninstalled');

      toast({ title: 'Skill removed', description: 'Skill has been uninstalled' });
      void queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });

  const uninstall = useCallback(
    async (skillKey: string): Promise<boolean> => {
      try {
        await uninstallMutation.mutateAsync(skillKey);
        return true;
      } catch {
        return false;
      }
    },
    [uninstallMutation]
  );

  const setDisabledMutation = useMutation({
    mutationFn: async ({ skillKey, disabled }: { skillKey: string; disabled: boolean }) => {
      const result = await rpc.skills.setDisabled({ skillKey, disabled });
      if (!result.success) throw new Error(result.error ?? 'Could not update skill');
      return { skillKey, disabled };
    },
    onError: (error, variables) => {
      toast({
        title: variables.disabled ? 'Disable failed' : 'Enable failed',
        description: error.message,
        variant: 'destructive',
      });
    },
    onSuccess: ({ skillKey, disabled }) => {
      const skill = queryClient
        .getQueryData<CatalogIndex>(skillsCatalogQueryKey)
        ?.skills.find((candidate) => candidate.key === skillKey);
      const label = skill?.displayName ?? skillKey;
      captureTelemetry(disabled ? 'skill_disabled' : 'skill_enabled');
      toast({
        title: disabled ? 'Skill disabled' : 'Skill enabled',
        description: disabled
          ? `${label} is no longer available to agents`
          : `${label} is available to agents again`,
      });
      void queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });

  const setDisabled = useCallback(
    async (skillKey: string, disabled: boolean): Promise<boolean> => {
      try {
        await setDisabledMutation.mutateAsync({ skillKey, disabled });
        return true;
      } catch {
        return false;
      }
    },
    [setDisabledMutation]
  );

  const setDisabledBatchMutation = useMutation({
    mutationFn: async ({ skillKeys, disabled }: { skillKeys: string[]; disabled: boolean }) => {
      const result = await rpc.skills.setDisabledBatch({ skillKeys, disabled });
      if (!result.success) throw new Error(result.error ?? t('skills.batchUpdateFailed'));
      return { disabled, updatedCount: result.data?.updatedCount ?? 0 };
    },
    onError: (error) => {
      toast({
        title: t('skills.batchUpdateFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
    onSuccess: ({ disabled, updatedCount }) => {
      toast({
        title: t(disabled ? 'skills.batchDisableSuccess' : 'skills.batchEnableSuccess', {
          count: updatedCount,
        }),
      });
      void queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });

  const setDisabledBatch = useCallback(
    async (skillKeys: string[], disabled: boolean): Promise<boolean> => {
      try {
        await setDisabledBatchMutation.mutateAsync({ skillKeys, disabled });
        return true;
      } catch {
        return false;
      }
    },
    [setDisabledBatchMutation]
  );

  const filteredSkills = useMemo(() => {
    if (!catalog) return [];
    const q = searchQuery.toLowerCase().trim();
    if (!q) return catalog.skills;
    return catalog.skills.filter(
      (s) =>
        s.displayName.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q)
    );
  }, [catalog, searchQuery]);

  const installedSkills = useMemo(
    () => filteredSkills.filter((s) => s.installed),
    [filteredSkills]
  );

  const recommendedSkills = useMemo(
    () => filteredSkills.filter((s) => !s.installed),
    [filteredSkills]
  );

  return {
    catalog,
    isLoading,
    isRefreshing: refreshMutation.isPending,
    searchQuery,
    setSearchQuery,
    filteredSkills,
    installedSkills,
    recommendedSkills,
    refresh,
    install,
    uninstall,
    setDisabled,
    setDisabledBatch,
  };
}
