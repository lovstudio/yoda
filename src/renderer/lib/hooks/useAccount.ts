import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { rpc } from '@renderer/lib/ipc';

export const ACCOUNT_SESSION_KEY = ['account:session'] as const;
const ACCOUNT_HEALTH_KEY = ['account:health'] as const;

export function useAccountSession() {
  return useQuery({
    queryKey: ACCOUNT_SESSION_KEY,
    queryFn: () => rpc.account.getSession(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useAccountSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: string | undefined) => rpc.account.signIn(provider),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...ACCOUNT_SESSION_KEY] });
      void queryClient.invalidateQueries({ queryKey: ['github:status'] });
      void queryClient.invalidateQueries({ queryKey: ['feature-flags'] });
    },
  });
}

export function useAccountRefreshSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => rpc.account.refreshSession(),
    onSuccess: (session) => {
      queryClient.setQueryData(ACCOUNT_SESSION_KEY, session);
    },
  });
}

export function useAccountUpdateNickname() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (nickname: string) => {
      const result = await rpc.account.updateNickname(nickname);
      if (!result.success || !result.session) {
        throw new Error(result.error || 'Failed to update nickname');
      }
      return result.session;
    },
    onSuccess: (session) => {
      queryClient.setQueryData(ACCOUNT_SESSION_KEY, session);
    },
  });
}

/**
 * Pre-warm the auth server (DNS + TLS + serverless cold start) while a
 * sign-in affordance is visible, so the device-code request is fast when
 * the user actually clicks. Main process dedupes calls to once a minute.
 */
export function useAccountAuthWarmUp(enabled: boolean) {
  useEffect(() => {
    if (enabled) void rpc.account.warmUpAuth();
  }, [enabled]);
}

export function useAccountSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => rpc.account.signOut(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...ACCOUNT_SESSION_KEY] });
    },
  });
}

export function useAccountHealth() {
  return useQuery({
    queryKey: ACCOUNT_HEALTH_KEY,
    queryFn: () => rpc.account.checkHealth(),
    staleTime: 60_000,
  });
}

export function useFetchAccountHealth() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.fetchQuery({
      queryKey: ACCOUNT_HEALTH_KEY,
      queryFn: () => rpc.account.checkHealth(),
      staleTime: 0,
    });
}
