import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { issueWorkerUpdatedChannel, type IssueWorkerConfigPatch } from '@shared/issue-worker';
import { events, rpc } from '@renderer/lib/ipc';

const issueWorkerQueryKey = (projectId: string) => ['issue-worker', projectId] as const;

export function useIssueWorker(projectId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    return events.on(issueWorkerUpdatedChannel, (status) => {
      if (status.projectId !== projectId) return;
      queryClient.setQueryData(issueWorkerQueryKey(projectId), status);
    });
  }, [projectId, queryClient]);

  const status = useQuery({
    queryKey: issueWorkerQueryKey(projectId),
    queryFn: () => rpc.issues.getWorkerStatus(projectId),
  });

  const configure = useMutation({
    mutationFn: (patch: IssueWorkerConfigPatch) => rpc.issues.configureWorker(projectId, patch),
    onSuccess: (next) => queryClient.setQueryData(issueWorkerQueryKey(projectId), next),
  });

  const runNow = useMutation({
    mutationFn: () => rpc.issues.runWorkerNow(projectId),
    onSuccess: (next) => queryClient.setQueryData(issueWorkerQueryKey(projectId), next),
  });

  return { status, configure, runNow };
}
