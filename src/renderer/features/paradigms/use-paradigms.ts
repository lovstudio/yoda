import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Paradigm, ParadigmDraft } from '@shared/paradigms/paradigm';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { invalidateParadigmQueries, paradigmsQueryKey } from './paradigm-queries';

/**
 * The paradigm instances the picker lists, plus the per-instance edits it offers.
 *
 * Presentation edits go through `update` with the instance's existing params: the
 * picker renames and re-icons, it does not reshape behavior — that is what each
 * kind's configuration panel is for.
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
    /** Rename and/or re-icon an instance, leaving its params untouched. */
    setPresentation: async (id: string, label: string, icon: string) => {
      const existing = paradigms.find((paradigm) => paradigm.id === id);
      if (!existing) return;
      await updateMutation.mutateAsync({
        id,
        draft: { kindId: existing.kindId, label, icon, params: existing.params },
      });
    },
    remove: removeMutation.mutateAsync,
    duplicate: duplicateMutation.mutateAsync,
  };
}
