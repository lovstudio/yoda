import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { promptsUpdatedChannel } from '@shared/events/appEvents';
import type {
  Prompt,
  PromptCreateInput,
  PromptUpdateInput,
  PromptVersionBump,
} from '@shared/prompt-library';
import { events, rpc } from '@renderer/lib/ipc';

export const promptsQueryKey = ['prompts'] as const;
export const promptVersionsQueryKey = (id: string) => ['promptVersions', id] as const;

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

export function usePromptVersions(id: string) {
  return useQuery({
    queryKey: promptVersionsQueryKey(id),
    queryFn: () => rpc.promptLibrary.listVersions(id),
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

export function useRestorePromptVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version, bump }: { id: string; version: string; bump: PromptVersionBump }) =>
      rpc.promptLibrary.restoreVersion(id, version, bump),
    onSettled: (_data, _error, input) => {
      void queryClient.invalidateQueries({ queryKey: promptsQueryKey });
      void queryClient.invalidateQueries({ queryKey: promptVersionsQueryKey(input.id) });
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

export function useReorderPrompts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => rpc.promptLibrary.reorderPrompts(ids),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: promptsQueryKey });
      const previous = queryClient.getQueryData<Prompt[]>(promptsQueryKey);
      queryClient.setQueryData<Prompt[]>(promptsQueryKey, (current) => {
        if (!current) return current;
        const promptsById = new Map(current.map((prompt) => [prompt.id, prompt]));
        return ids.map((id) => promptsById.get(id)).filter((prompt): prompt is Prompt => !!prompt);
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

export function useSetTagInjectionEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tag, enabled }: { tag: string; enabled: boolean }) =>
      rpc.promptLibrary.setTagInjectionEnabled(tag, enabled),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: promptsQueryKey });
    },
  });
}

export function useRemovePromptTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tag: string) => rpc.promptLibrary.removeTag(tag),
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
