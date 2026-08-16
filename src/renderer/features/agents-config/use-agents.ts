import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { Agent, AgentDraft } from '@shared/agents';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';

const AGENTS_QUERY_KEY = ['agentsConfig', 'list'] as const;

export function useAgents() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: agents = [], isPending: isLoading } = useQuery<Agent[]>({
    queryKey: AGENTS_QUERY_KEY,
    queryFn: () => rpc.agentsConfig.list(),
  });

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY }),
    [queryClient]
  );

  const createMutation = useMutation({
    mutationFn: (draft: AgentDraft) => rpc.agentsConfig.create(draft),
    onSuccess: () => void invalidate(),
    onError: (error: Error) =>
      toast({ title: 'Create failed', description: error.message, variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: AgentDraft }) =>
      rpc.agentsConfig.update(id, draft),
    onSuccess: () => void invalidate(),
    onError: (error: Error) =>
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' }),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => rpc.agentsConfig.remove(id),
    onSuccess: () => void invalidate(),
    onError: (error: Error) =>
      toast({ title: 'Delete failed', description: error.message, variant: 'destructive' }),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => rpc.agentsConfig.duplicate(id),
    onSuccess: () => void invalidate(),
    onError: (error: Error) =>
      toast({ title: 'Duplicate failed', description: error.message, variant: 'destructive' }),
  });

  const { mutateAsync: duplicateAgent } = duplicateMutation;
  // Resolves to the copy so callers can seat or edit it right away, and to null
  // on failure — the error is already surfaced as a toast above, so no call site
  // has to carry a rejection just to ignore it.
  const duplicate = useCallback(
    async (id: string): Promise<Agent | null> => {
      try {
        return await duplicateAgent(id);
      } catch {
        return null;
      }
    },
    [duplicateAgent]
  );

  return {
    agents,
    isLoading,
    create: createMutation.mutateAsync,
    update: updateMutation.mutateAsync,
    remove: removeMutation.mutateAsync,
    duplicate,
    isMutating: createMutation.isPending || updateMutation.isPending || removeMutation.isPending,
  };
}
