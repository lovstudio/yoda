import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { AgentTeam, AgentTeamDraft } from '@shared/agent-team';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';

/** Shared with the home composer's team paradigm query so edits refresh both. */
const TEAMS_QUERY_KEY = ['agentTeams'] as const;

export function useAgentTeams() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: teams = [], isPending: isLoading } = useQuery<AgentTeam[]>({
    queryKey: TEAMS_QUERY_KEY,
    queryFn: () => rpc.agentTeams.list(),
  });

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: TEAMS_QUERY_KEY }),
    [queryClient]
  );

  const onError = (title: string) => (error: Error) =>
    toast({ title, description: error.message, variant: 'destructive' });

  const createMutation = useMutation({
    mutationFn: (draft: AgentTeamDraft) => rpc.agentTeams.create(draft),
    onSuccess: () => void invalidate(),
    onError: onError('Create failed'),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: AgentTeamDraft }) =>
      rpc.agentTeams.update(id, draft),
    onSuccess: () => void invalidate(),
    onError: onError('Update failed'),
  });
  const removeMutation = useMutation({
    mutationFn: (id: string) => rpc.agentTeams.remove(id),
    onSuccess: () => void invalidate(),
    onError: onError('Delete failed'),
  });
  const duplicateMutation = useMutation({
    mutationFn: (id: string) => rpc.agentTeams.duplicate(id),
    onSuccess: () => void invalidate(),
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
