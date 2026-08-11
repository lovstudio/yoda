import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BrowserSessionHealthSnapshot,
  BrowserSessionHealthTargetInput,
} from '@shared/browser-session-health';
import { rpc } from '@renderer/lib/ipc';

export const browserSessionHealthQueryKey = ['browserSessionHealth'] as const;

export type { BrowserSessionHealthTargetInput } from '@shared/browser-session-health';

export function useBrowserSessionHealth() {
  return useQuery({
    queryKey: browserSessionHealthQueryKey,
    queryFn: () => rpc.browserSessionHealth.getSnapshot(),
    refetchInterval: 15_000,
  });
}

export function useSetBrowserSessionHealthEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => rpc.browserSessionHealth.setEnabled(enabled),
    onMutate: async (enabled) => {
      await queryClient.cancelQueries({ queryKey: browserSessionHealthQueryKey });
      const previous = queryClient.getQueryData<BrowserSessionHealthSnapshot>(
        browserSessionHealthQueryKey
      );
      if (previous) {
        queryClient.setQueryData<BrowserSessionHealthSnapshot>(browserSessionHealthQueryKey, {
          ...previous,
          config: { ...previous.config, enabled },
        });
      }
      return { previous };
    },
    onError: (_error, _enabled, context) => {
      if (context?.previous) {
        queryClient.setQueryData(browserSessionHealthQueryKey, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: browserSessionHealthQueryKey });
    },
  });
}

export function useUpsertBrowserSessionHealthTarget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BrowserSessionHealthTargetInput) =>
      rpc.browserSessionHealth.upsertTarget(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: browserSessionHealthQueryKey });
      const previous = queryClient.getQueryData<BrowserSessionHealthSnapshot>(
        browserSessionHealthQueryKey
      );
      if (previous && input.id) {
        queryClient.setQueryData<BrowserSessionHealthSnapshot>(browserSessionHealthQueryKey, {
          ...previous,
          config: {
            ...previous.config,
            targets: previous.config.targets.map((target) =>
              target.id === input.id ? { ...target, ...input, id: input.id } : target
            ),
          },
          targets: previous.targets.map((target) =>
            target.id === input.id ? { ...target, ...input, id: input.id } : target
          ),
        });
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(browserSessionHealthQueryKey, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: browserSessionHealthQueryKey });
    },
  });
}

export function useRemoveBrowserSessionHealthTarget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rpc.browserSessionHealth.removeTarget(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: browserSessionHealthQueryKey });
      const previous = queryClient.getQueryData<BrowserSessionHealthSnapshot>(
        browserSessionHealthQueryKey
      );
      if (previous) {
        queryClient.setQueryData<BrowserSessionHealthSnapshot>(browserSessionHealthQueryKey, {
          ...previous,
          config: {
            ...previous.config,
            targets: previous.config.targets.filter((target) => target.id !== id),
          },
          targets: previous.targets.filter((target) => target.id !== id),
        });
      }
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(browserSessionHealthQueryKey, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: browserSessionHealthQueryKey });
    },
  });
}

export function useRunBrowserSessionHealthTarget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rpc.browserSessionHealth.runNow(id),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: browserSessionHealthQueryKey });
    },
  });
}

export function useResumeBrowserSessionHealthAfterLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (targetId: string) => rpc.browserSessionHealth.resumeAfterLogin(targetId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: browserSessionHealthQueryKey });
    },
  });
}
