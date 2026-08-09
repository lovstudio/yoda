import { rpc } from '@renderer/lib/ipc';

export function taskDeliverySummariesQuery(projectId: string, taskId: string) {
  return {
    queryKey: ['taskDeliverySummaries', projectId, taskId] as const,
    queryFn: () => rpc.conversations.getTaskDeliverySummaries(projectId, taskId),
    staleTime: 15_000,
  };
}
