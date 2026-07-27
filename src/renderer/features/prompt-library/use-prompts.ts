import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { promptsUpdatedChannel } from '@shared/events/appEvents';
import type { PromptCreateInput, PromptUpdateInput } from '@shared/prompt-library';
import { events, rpc } from '@renderer/lib/ipc';

export const promptsQueryKey = ['prompts'] as const;
export const promptGroupsQueryKey = ['promptGroups'] as const;

export function usePrompts() {
  const queryClient = useQueryClient();

  useEffect(() => {
    return events.on(promptsUpdatedChannel, () => {
      void queryClient.invalidateQueries({ queryKey: promptsQueryKey });
    });
  }, [queryClient]);

  return useQuery({
    queryKey: promptsQueryKey,
    queryFn: () => rpc.promptLibrary.list(),
  });
}

export function usePromptGroups() {
  const queryClient = useQueryClient();

  useEffect(() => {
    return events.on(promptsUpdatedChannel, () => {
      void queryClient.invalidateQueries({ queryKey: promptGroupsQueryKey });
    });
  }, [queryClient]);

  return useQuery({
    queryKey: promptGroupsQueryKey,
    queryFn: () => rpc.promptLibrary.listGroups(),
  });
}

export function useCreatePromptGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => rpc.promptLibrary.createGroup(name),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: promptGroupsQueryKey });
    },
  });
}

export function useCreatePrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PromptCreateInput) => rpc.promptLibrary.create(input),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: promptsQueryKey });
    },
  });
}

export function useUpdatePrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: PromptUpdateInput }) =>
      rpc.promptLibrary.update(id, patch),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: promptsQueryKey });
    },
  });
}

export function useDeletePrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rpc.promptLibrary.delete(id),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: promptsQueryKey });
    },
  });
}

export function useReorderInjectedPrompts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => rpc.promptLibrary.reorderInjection(ids),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: promptsQueryKey });
    },
  });
}

export function useRefreshPromptSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rpc.promptLibrary.refreshSource(id),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: promptsQueryKey });
    },
  });
}
