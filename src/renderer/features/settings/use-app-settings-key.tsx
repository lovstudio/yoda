import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppSettings, AppSettingsKey } from '@shared/app-settings';
import { rpc } from '@renderer/lib/ipc';
import {
  invalidateTerminalSettingsCache,
  patchTerminalSettingsCache,
} from '@renderer/lib/pty/terminal-settings-cache';

type SettingsMeta<K extends AppSettingsKey> = {
  value: AppSettings[K];
  defaults: AppSettings[K];
  overrides: Partial<AppSettings[K]>;
};

/**
 * Settings metadata is useful for rendering override affordances, but it must
 * never hold the main application layout hostage when IPC is unhealthy.
 */
export const APP_SETTINGS_META_REQUEST_TIMEOUT_MS = 500;

/**
 * Failing fast is only safe if we also come back for the real value. A cold
 * boot routinely keeps the main process busy for longer than the deadline
 * above, and a settings key stuck on `undefined` reads to every consumer as
 * "the user never changed this" — that is how a persisted theme silently
 * reverted to the default on restart. Retries run in the background (the query
 * is already out of its pending state, so `isLoading` stays false) until the
 * main process answers.
 */
export const APP_SETTINGS_META_RETRY_INTERVAL_MS = 1_000;

async function loadSettingsMeta<K extends AppSettingsKey>(key: K): Promise<SettingsMeta<K>> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const request = rpc.appSettings.getWithMeta(key) as Promise<SettingsMeta<K>>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          `App settings metadata request for ${String(key)} exceeded ${APP_SETTINGS_META_REQUEST_TIMEOUT_MS}ms`
        )
      );
    }, APP_SETTINGS_META_REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function mergeValue<K extends AppSettingsKey>(
  current: AppSettings[K] | undefined,
  partial: Partial<AppSettings[K]>
): AppSettings[K] {
  if (
    typeof partial === 'object' &&
    partial !== null &&
    typeof current === 'object' &&
    current !== null
  ) {
    return { ...current, ...partial } as AppSettings[K];
  }
  return partial as AppSettings[K];
}

export function useAppSettingsKey<K extends AppSettingsKey>(key: K) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<SettingsMeta<K>>({
    queryKey: ['appSettings', key, 'meta'] as const,
    queryFn: () => loadSettingsMeta(key),
    retry: false,
    refetchInterval: (query) =>
      query.state.status === 'error' ? APP_SETTINGS_META_RETRY_INTERVAL_MS : false,
    // A cold boot often finishes while the window is unfocused; without this the
    // recovery poll would wait for the user to click back in.
    refetchIntervalInBackground: true,
    staleTime: 5 * 60_000,
  });

  const updateMutation = useMutation<
    void,
    Error,
    Partial<AppSettings[K]>,
    { prev: SettingsMeta<K> | undefined }
  >({
    mutationFn: (partial) => rpc.appSettings.update(key, partial) as Promise<void>,
    onMutate: async (partial) => {
      if (key === 'terminal') {
        patchTerminalSettingsCache(partial as Partial<AppSettings['terminal']>);
      }
      await queryClient.cancelQueries({ queryKey: ['appSettings', key, 'meta'] });
      const prev = queryClient.getQueryData<SettingsMeta<K>>(['appSettings', key, 'meta']);
      queryClient.setQueryData(['appSettings', key, 'meta'], (old: SettingsMeta<K> | undefined) =>
        old ? { ...old, value: mergeValue(old.value, partial) } : old
      );
      queryClient.setQueryData(['appSettings', 'all'], (all: AppSettings | undefined) =>
        all && prev ? ({ ...all, [key]: mergeValue(prev.value, partial) } as AppSettings) : all
      );
      return { prev };
    },
    onError: (_err, _partial, ctx) => {
      if (key === 'terminal') invalidateTerminalSettingsCache();
      if (ctx?.prev !== undefined) {
        queryClient.setQueryData(['appSettings', key, 'meta'], ctx.prev);
      }
      void queryClient.invalidateQueries({ queryKey: ['appSettings', key, 'meta'] });
      void queryClient.invalidateQueries({ queryKey: ['appSettings', 'all'] });
    },
    onSettled: () => {
      // A successful terminal update must replace the optimistic snapshot with
      // the authoritative server value. On failure this is intentionally
      // idempotent with onError and guarantees no optimistic partial survives.
      if (key === 'terminal') invalidateTerminalSettingsCache();
      void queryClient.invalidateQueries({ queryKey: ['appSettings', key, 'meta'] });
      void queryClient.invalidateQueries({ queryKey: ['appSettings', 'all'] });
    },
  });

  const resetMutation = useMutation<void, Error, void>({
    mutationFn: () => rpc.appSettings.reset(key) as Promise<void>,
    onSuccess: () => {
      if (key === 'terminal') invalidateTerminalSettingsCache();
      void queryClient.invalidateQueries({ queryKey: ['appSettings', key, 'meta'] });
      void queryClient.invalidateQueries({ queryKey: ['appSettings', 'all'] });
    },
  });

  const resetFieldMutation = useMutation<void, Error, keyof AppSettings[K]>({
    mutationFn: (field) => rpc.appSettings.resetField(key, field as string) as Promise<void>,
    onSuccess: () => {
      if (key === 'terminal') invalidateTerminalSettingsCache();
      void queryClient.invalidateQueries({ queryKey: ['appSettings', key, 'meta'] });
      void queryClient.invalidateQueries({ queryKey: ['appSettings', 'all'] });
    },
  });

  return {
    value: data?.value,
    defaults: data?.defaults,
    overrides: data?.overrides,
    isLoading,
    isSaving: updateMutation.isPending,
    isOverridden: !!(data?.overrides && Object.keys(data.overrides).length > 0),
    isFieldOverridden: (field: keyof AppSettings[K]) =>
      !!(data?.overrides && field in data.overrides),
    update: updateMutation.mutate,
    reset: resetMutation.mutate,
    resetField: (field: keyof AppSettings[K]) => resetFieldMutation.mutate(field),
  };
}
