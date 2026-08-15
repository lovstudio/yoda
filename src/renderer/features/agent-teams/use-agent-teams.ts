import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { AgentTeam, AgentTeamDraft } from '@shared/agent-team';
import {
  agentTeamsQueryKey,
  invalidateParadigmQueries,
} from '@renderer/features/paradigms/paradigm-queries';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';

export function useAgentTeams() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: teams = [], isPending: isLoading } = useQuery<AgentTeam[]>({
    queryKey: agentTeamsQueryKey,
    queryFn: () => rpc.agentTeams.list(),
  });

  // A team is a `team`-kind paradigm row, so an edit here also changes the
  // paradigm picker's list.
  const invalidate = useCallback(() => invalidateParadigmQueries(queryClient), [queryClient]);

  const onError = (title: string) => (error: Error) =>
    toast({ title, description: error.message, variant: 'destructive' });

  const createMutation = useMutation({
    mutationFn: (draft: AgentTeamDraft) => rpc.agentTeams.create(draft),
    onSuccess: () => invalidate(),
    onError: onError('Create failed'),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: AgentTeamDraft }) =>
      rpc.agentTeams.update(id, draft),
    onSuccess: () => invalidate(),
    onError: onError('Update failed'),
  });
  const removeMutation = useMutation({
    mutationFn: (id: string) => rpc.agentTeams.remove(id),
    onSuccess: () => invalidate(),
    onError: onError('Delete failed'),
  });
  const duplicateMutation = useMutation({
    mutationFn: (id: string) => rpc.agentTeams.duplicate(id),
    onSuccess: () => invalidate(),
    onError: onError('Duplicate failed'),
  });

  return {
    teams,
    isLoading,
    create: createMutation.mutateAsync,
    update: updateMutation.mutateAsync,
    remove: removeMutation.mutateAsync,
    duplicate: duplicateMutation.mutate,
    isMutating: createMutation.isPending || updateMutation.isPending || removeMutation.isPending,
  };
}
