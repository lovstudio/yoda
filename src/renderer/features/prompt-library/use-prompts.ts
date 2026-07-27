import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { promptsUpdatedChannel } from '@shared/events/appEvents';
import type { Prompt, PromptCreateInput, PromptUpdateInput } from '@shared/prompt-library';
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
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: promptsQueryKey });
      const previous = queryClient.getQueryData<Prompt[]>(promptsQueryKey);
      const order = new Map(ids.map((id, index) => [id, index]));
      queryClient.setQueryData<Prompt[]>(promptsQueryKey, (current) =>
        current?.map((prompt) => ({
          ...prompt,
          injectionOrder: order.get(prompt.id) ?? prompt.injectionOrder,
        }))
      );
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(promptsQueryKey, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: promptsQueryKey });
    },
  });
}

export function useSetPromptGroupInjectionEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupName, enabled }: { groupName: string; enabled: boolean }) =>
      rpc.promptLibrary.setGroupInjectionEnabled(groupName, enabled),
    onMutate: async ({ groupName, enabled }) => {
      await queryClient.cancelQueries({ queryKey: promptsQueryKey });
      const previous = queryClient.getQueryData<Prompt[]>(promptsQueryKey);
      queryClient.setQueryData<Prompt[]>(promptsQueryKey, (current) =>
        current?.map((prompt) =>
          prompt.groupName.trim() === groupName.trim()
            ? { ...prompt, injectionEnabled: enabled }
            : prompt
        )
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(promptsQueryKey, context.previous);
    },
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
