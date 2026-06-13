import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { AutomationCreateInput, AutomationUpdateInput } from '@shared/automation';
import { automationRunsUpdatedChannel, automationsUpdatedChannel } from '@shared/events/appEvents';
import { events, rpc } from '@renderer/lib/ipc';

export const automationsQueryKey = ['automations'] as const;
export const automationHistoryQueryKey = ['automationHistory'] as const;

export function useAutomations() {
  const queryClient = useQueryClient();

  // Live updates: CRUD and run-state changes both refresh the list (run-state
  // carries lastRunAt / nextRunAt advances).
  useEffect(() => {
    const off1 = events.on(automationsUpdatedChannel, () => {
      void queryClient.invalidateQueries({ queryKey: automationsQueryKey });
    });
    const off2 = events.on(automationRunsUpdatedChannel, () => {
      void queryClient.invalidateQueries({ queryKey: automationsQueryKey });
    });
    return () => {
      off1();
      off2();
    };
  }, [queryClient]);

  return useQuery({
    queryKey: automationsQueryKey,
    queryFn: () => rpc.automation.list(),
  });
}

export function useAutomationHistory(automationId?: string, limit?: number) {
  const queryClient = useQueryClient();

  useEffect(() => {
    return events.on(automationRunsUpdatedChannel, () => {
      void queryClient.invalidateQueries({ queryKey: automationHistoryQueryKey });
    });
  }, [queryClient]);

  return useQuery({
    queryKey: [...automationHistoryQueryKey, automationId ?? 'all', limit ?? 50],
    queryFn: () => rpc.automation.history(automationId, limit),
  });
}

export function useCreateAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AutomationCreateInput) => rpc.automation.create(input),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: automationsQueryKey });
    },
  });
}

export function useUpdateAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: AutomationUpdateInput }) =>
      rpc.automation.update(id, patch),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: automationsQueryKey });
    },
  });
}

export function useDeleteAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rpc.automation.delete(id),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: automationsQueryKey });
    },
  });
}

export function useRunAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rpc.automation.run(id),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: automationsQueryKey });
      void queryClient.invalidateQueries({ queryKey: automationHistoryQueryKey });
    },
  });
}
