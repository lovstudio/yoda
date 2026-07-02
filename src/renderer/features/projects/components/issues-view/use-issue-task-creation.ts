import { useState } from 'react';
import type { Branch } from '@shared/git';
import type { RuntimeId } from '@shared/runtime-registry';
import { ensureUniqueTaskDisplayName, normalizeTaskDisplayName } from '@shared/task-name';
import { formatIssueFixPrompt, type CreateTaskParams, type Issue } from '@shared/tasks';
import {
  getProjectManagerStore,
  getRepositoryStore,
  mountedProjectData,
} from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { initialConversationTitle } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { useEffectiveRuntime } from '@renderer/features/tasks/conversations/use-effective-runtime';
import { resolveBranchLikeTaskStrategy } from '@renderer/features/tasks/create-task-modal/create-task-strategy';
import { getIssueTaskName } from '@renderer/features/tasks/create-task-modal/issue-task-name';
import { getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';
import { toast } from '@renderer/lib/hooks/use-toast';
import i18n from '@renderer/lib/i18n';
import { appState } from '@renderer/lib/stores/app-state';
import { getLinkedTaskStores } from './issue-task-links';

type Translate = (key: string, options?: Record<string, unknown>) => string;

const translate: Translate = (key, options) => i18n.t(key, options);

function issueTaskDisplayName(issue: Issue, t: Translate): string {
  const providerName = getIssueTaskName(issue);
  if (providerName) return providerName;

  const title = issue.title.trim() || issue.identifier;
  const name = issue.identifier
    ? t('issues.taskNameWithIdentifier', { identifier: issue.identifier, title })
    : t('issues.taskName', { title });
  const fallback = issue.identifier ? `Issue ${issue.identifier}` : `Issue ${title}`;
  return normalizeTaskDisplayName(name) || normalizeTaskDisplayName(fallback);
}

function resolveIssueSourceBranch({
  projectId,
  createBranchAndWorktree,
}: {
  projectId: string;
  createBranchAndWorktree: boolean;
}): Branch | undefined {
  const repo = getRepositoryStore(projectId);
  if (!repo) return undefined;

  if (!createBranchAndWorktree && repo.currentBranch) {
    return { type: 'local', branch: repo.currentBranch };
  }

  if (repo.defaultBranch) return repo.defaultBranch;
  if (repo.currentBranch) return { type: 'local', branch: repo.currentBranch };
  return undefined;
}

function buildIssueTaskParams({
  id,
  projectId,
  issue,
  name,
  sourceBranch,
  isUnborn,
  createBranchAndWorktree,
  pushBranch,
  runtimeId,
}: {
  id: string;
  projectId: string;
  issue: Issue;
  name: string;
  sourceBranch: Branch;
  isUnborn: boolean;
  createBranchAndWorktree: boolean;
  pushBranch: boolean;
  runtimeId: RuntimeId | null;
}): CreateTaskParams {
  const initialPrompt = formatIssueFixPrompt(issue);

  return {
    id,
    projectId,
    name,
    sourceBranch,
    strategy: resolveBranchLikeTaskStrategy({
      isUnborn,
      createBranchAndWorktree,
      taskBranch: name,
      pushBranch,
    }),
    linkedIssue: issue,
    initialConversation: runtimeId
      ? {
          id: crypto.randomUUID(),
          projectId,
          taskId: id,
          runtime: runtimeId,
          title: initialConversationTitle(runtimeId, initialPrompt, []),
          initialPrompt,
        }
      : undefined,
  };
}

export function useIssueTaskCreation(projectId: string, issues: Issue[]) {
  const [isCreatingIssueTasks, setIsCreatingIssueTasks] = useState(false);
  const { value: projectSettings } = useAppSettingsKey('project');
  const projectData = mountedProjectData(getProjectManagerStore().projects.get(projectId));
  const connectionId = projectData?.type === 'ssh' ? projectData.connectionId : undefined;
  const { runtimeId } = useEffectiveRuntime(connectionId);

  const taskableIssues = issues.filter(
    (issue) => getLinkedTaskStores(projectId, issue).length === 0
  );

  const createIssueTasks = async (targetIssues: Issue[]) => {
    const pendingIssues = targetIssues.filter(
      (issue) => getLinkedTaskStores(projectId, issue).length === 0
    );
    if (pendingIssues.length === 0) return;

    const manager = getTaskManagerStore(projectId);
    const repo = getRepositoryStore(projectId);
    if (!manager || !repo) {
      toast.error(i18n.t('projects.projectNotReady'));
      return;
    }

    try {
      setIsCreatingIssueTasks(true);

      await Promise.all([repo.localData.load(), repo.remoteData.load()]);

      const createBranchAndWorktree = repo.isUnborn
        ? false
        : (projectSettings?.createBranchAndWorktree ?? true);
      const pushBranch = projectSettings?.pushOnCreate ?? true;
      const sourceBranch = resolveIssueSourceBranch({ projectId, createBranchAndWorktree });

      if (!sourceBranch) {
        toast.error(i18n.t('issues.noSourceBranchForTask'));
        return;
      }

      const existingNames = new Set(
        Array.from(manager.tasks.values(), (task) => task.data.name).filter(Boolean)
      );
      let created = 0;
      const failures: string[] = [];

      for (const issue of pendingIssues) {
        const id = crypto.randomUUID();
        const name = ensureUniqueTaskDisplayName(
          issueTaskDisplayName(issue, translate),
          existingNames
        );
        existingNames.add(name);

        const params = buildIssueTaskParams({
          id,
          projectId,
          issue,
          name,
          sourceBranch,
          isUnborn: repo.isUnborn,
          createBranchAndWorktree,
          pushBranch,
          runtimeId,
        });

        try {
          await manager.createTask(params);
          created += 1;
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }

      if (created > 0) {
        toast.success(i18n.t('issues.tasksCreated', { count: created }));
        appState.appTabs.openTab('project', { projectId, view: 'tasks' });
      }

      if (failures.length > 0) {
        toast.error(i18n.t('issues.tasksCreateFailed', { count: failures.length }), {
          description: failures[0],
        });
      }
    } finally {
      setIsCreatingIssueTasks(false);
    }
  };

  return {
    createIssueTasks,
    isCreatingIssueTasks,
    taskableIssues,
  };
}
