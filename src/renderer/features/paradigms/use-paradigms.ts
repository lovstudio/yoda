import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Paradigm, ParadigmDraft } from '@shared/paradigms/paradigm';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { invalidateParadigmQueries, paradigmsQueryKey } from './paradigm-queries';

/**
 * The paradigm instances the picker lists, plus the writes it offers.
 *
 * Everything lands as one `update` of the whole draft, because a paradigm's kind,
 * name, and params are one coherent record: editing a roster can change the kind,
 * and writing the params without it would leave a row nobody can parse. The narrow
 * helpers below are that same write with the fields the caller is not touching
 * carried over.
 */
export function useParadigms() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: paradigms = [], isPending } = useQuery<Paradigm[]>({
    queryKey: paradigmsQueryKey,
    queryFn: () => rpc.paradigms.list(),
  });

  const onError = (titleKey: string) => (error: Error) =>
    toast({ title: titleKey, description: error.message, variant: 'destructive' });

  const createMutation = useMutation({
    mutationFn: (draft: ParadigmDraft) => rpc.paradigms.create(draft),
    onSuccess: () => invalidateParadigmQueries(queryClient),
    onError: onError('Create failed'),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: ParadigmDraft }) =>
      rpc.paradigms.update(id, draft),
    onSuccess: () => invalidateParadigmQueries(queryClient),
    onError: onError('Update failed'),
  });
  const removeMutation = useMutation({
    mutationFn: (id: string) => rpc.paradigms.remove(id),
    onSuccess: () => invalidateParadigmQueries(queryClient),
    onError: onError('Delete failed'),
  });
  const duplicateMutation = useMutation({
    mutationFn: (id: string) => rpc.paradigms.duplicate(id),
    onSuccess: () => invalidateParadigmQueries(queryClient),
    onError: onError('Duplicate failed'),
  });

  return {
    paradigms,
    isPending,
    /** A new paradigm instance from scratch. */
    create: createMutation.mutateAsync,
    /**
     * Replace an instance wholesale — kind included.
     *
     * The kind is part of the draft rather than pinned to the row because a
     * paradigm is a set of Agents and the kinds are two ways of storing that set:
     * growing from one Agent to several has to be able to cross between them.
     */
    update: (id: string, draft: ParadigmDraft) => updateMutation.mutateAsync({ id, draft }),
    /** Rename and/or re-icon an instance, leaving its params untouched. */
    setPresentation: async (id: string, label: string, icon: string) => {
      const existing = paradigms.find((paradigm) => paradigm.id === id);
      if (!existing) return;
      await updateMutation.mutateAsync({
        id,
        draft: { kindId: existing.kindId, label, icon, params: existing.params },
      });
    },
    /**
     * Replace an instance's params wholesale, leaving its name and icon alone.
     *
     * This is the write a kind's configuration panel uses: what a paradigm runs
     * with lives entirely in its own params, so a panel edits those and nothing
     * else. Shipped instances included — they are defaults, not fixtures.
     */
    setParams: async (id: string, params: unknown) => {
      const existing = paradigms.find((paradigm) => paradigm.id === id);
      if (!existing) return;
      await updateMutation.mutateAsync({
        id,
        draft: { kindId: existing.kindId, label: existing.label, icon: existing.icon, params },
      });
    },
    remove: removeMutation.mutateAsync,
    duplicate: duplicateMutation.mutateAsync,
  };
}
