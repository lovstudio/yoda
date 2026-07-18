import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateAiLabAppInput, LogoGenerationInput, UpdateAiLabAppInput } from '@shared/ai-lab';
import { rpc } from '@renderer/lib/ipc';

export const aiLabQueryKeys = {
  engines: ['aiLab', 'engines'] as const,
  generations: ['aiLab', 'generations'] as const,
  image: (id: string, index: number) => ['aiLab', 'image', id, index] as const,
  apps: ['aiLab', 'apps'] as const,
};

export function useAiLabApps() {
  return useQuery({
    queryKey: aiLabQueryKeys.apps,
    queryFn: () => rpc.aiLab.listApps(),
  });
}

export function useCreateAiLabApp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAiLabAppInput) => rpc.aiLab.createApp(input),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: aiLabQueryKeys.apps }),
  });
}

export function useUpdateAiLabApp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateAiLabAppInput) => rpc.aiLab.updateApp(input),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: aiLabQueryKeys.apps }),
  });
}

export function useDeleteAiLabApp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rpc.aiLab.deleteApp(id),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: aiLabQueryKeys.apps }),
  });
}

export function useAiLabEngines() {
  return useQuery({
    queryKey: aiLabQueryKeys.engines,
    queryFn: () => rpc.aiLab.listEngines(),
    staleTime: 30_000,
  });
}

export function useLogoGenerations() {
  return useQuery({
    queryKey: aiLabQueryKeys.generations,
    queryFn: () => rpc.aiLab.listGenerations(),
  });
}

export function useGenerateLogo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LogoGenerationInput) => rpc.aiLab.generateLogo(input),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: aiLabQueryKeys.generations });
    },
  });
}

export function useDeleteLogoGeneration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rpc.aiLab.deleteGeneration(id),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: aiLabQueryKeys.generations });
    },
  });
}

/** Full-resolution image for the preview dialog, fetched lazily per image. */
export function useLogoGenerationImage(id: string | null, index: number | null) {
  return useQuery({
    queryKey: aiLabQueryKeys.image(id ?? '', index ?? 0),
    queryFn: () => rpc.aiLab.getGenerationImage({ id: id ?? '', index: index ?? 0 }),
    enabled: id !== null && index !== null,
    staleTime: Infinity,
  });
}
