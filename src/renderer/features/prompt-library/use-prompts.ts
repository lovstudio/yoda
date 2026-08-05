import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { promptsUpdatedChannel } from '@shared/events/appEvents';
import type {
  Prompt,
  PromptCreateInput,
  PromptGroup,
  PromptUpdateInput,
} from '@shared/prompt-library';
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
    mutationFn: ({ name, parentName }: { name: string; parentName: string | null }) =>
      rpc.promptLibrary.createGroup(name, parentName),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: promptGroupsQueryKey });
    },
  });
}

export function useMovePromptGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, parentName }: { name: string; parentName: string | null }) =>
      rpc.promptLibrary.moveGroup(name, parentName),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: promptGroupsQueryKey });
      void queryClient.invalidateQueries({ queryKey: promptsQueryKey });
    },
  });
}

export function useDeletePromptGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => rpc.promptLibrary.deleteGroup(name),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: promptGroupsQueryKey });
      void queryClient.invalidateQueries({ queryKey: promptsQueryKey });
    },
  });
}

export function useRenamePromptGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ currentName, nextName }: { currentName: string; nextName: string }) =>
      rpc.promptLibrary.renameGroup(currentName, nextName),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: promptGroupsQueryKey });
      void queryClient.invalidateQueries({ queryKey: promptsQueryKey });
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

export function useReorderPromptGroups() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ parentName, names }: { parentName: string | null; names: string[] }) =>
      rpc.promptLibrary.reorderGroups(parentName, names),
    onMutate: async ({ parentName, names }) => {
      await queryClient.cancelQueries({ queryKey: promptGroupsQueryKey });
      const previous = queryClient.getQueryData<PromptGroup[]>(promptGroupsQueryKey);
      queryClient.setQueryData<PromptGroup[]>(promptGroupsQueryKey, (current) => {
        if (!current) return current;
        const order = new Map(names.map((name, index) => [name, index]));
        const siblingIndexes = current.flatMap((group, index) =>
          group.parentName === parentName ? [index] : []
        );
        const siblings = current
          .filter((group) => group.parentName === parentName)
          .sort(
            (left, right) =>
              (order.get(left.name) ?? Number.MAX_SAFE_INTEGER) -
              (order.get(right.name) ?? Number.MAX_SAFE_INTEGER)
          );
        const next = current.slice();
        siblingIndexes.forEach((index, siblingIndex) => {
          const group = siblings[siblingIndex];
          if (group) next[index] = group;
        });
        return next;
      });
      return { previous };
    },
    onError: (_error, _names, context) => {
      if (context?.previous) queryClient.setQueryData(promptGroupsQueryKey, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: promptGroupsQueryKey });
      void queryClient.invalidateQueries({ queryKey: promptsQueryKey });
    },
  });
}

export function useReorderPrompts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupName, ids }: { groupName: string; ids: string[] }) =>
      rpc.promptLibrary.reorderPrompts(groupName, ids),
    onMutate: async ({ groupName, ids }) => {
      await queryClient.cancelQueries({ queryKey: promptsQueryKey });
      const previous = queryClient.getQueryData<Prompt[]>(promptsQueryKey);
      queryClient.setQueryData<Prompt[]>(promptsQueryKey, (current) => {
        if (!current) return current;
        const promptsById = new Map(current.map((prompt) => [prompt.id, prompt]));
        const groupIndexes = current.flatMap((prompt, index) =>
          prompt.groupName.trim() === groupName.trim() ? [index] : []
        );
        const next = current.slice();
        groupIndexes.forEach((index, groupIndex) => {
          const prompt = promptsById.get(ids[groupIndex] ?? '');
          if (prompt) next[index] = prompt;
        });
        return next;
      });
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
