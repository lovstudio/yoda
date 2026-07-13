import { useQuery } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';

export type ProjectData = {
  type: 'local' | 'ssh';
  path: string;
  connectionId?: string;
};

export function useHarnessData(projectId: string, projectData: ProjectData | undefined) {
  return useQuery({
    queryKey: [
      'project-harness',
      projectId,
      projectData?.type ?? '',
      projectData?.path ?? '',
      projectData?.connectionId ?? '',
    ],
    queryFn: async () => {
      if (!projectData) throw new Error('project not mounted');
      const result = await rpc.skills.getHarnessSnapshot({ projectId });
      if (!result.success) throw new Error(result.error);
      if (!result.data) throw new Error('project harness snapshot unavailable');
      return result.data.runtimes;
    },
    enabled: Boolean(projectData),
    refetchOnMount: 'always',
  });
}
