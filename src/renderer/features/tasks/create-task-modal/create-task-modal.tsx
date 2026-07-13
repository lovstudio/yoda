import { ChevronRight, FolderOpen } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatPullRequestReviewPrompt,
  getPrNumber,
  isForkPr,
  type PullRequest,
} from '@shared/pull-requests';
import { formatIssueFixPrompt, type CreateTaskParams, type Issue } from '@shared/tasks';
import {
  getProjectManagerStore,
  getRepositoryStore,
  mountedProjectData,
} from '@renderer/features/projects/stores/project-selectors';
import { initialConversationTitle } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { ProjectSelector } from '@renderer/features/tasks/create-task-modal/project-selector';
import { useFeatureFlag } from '@renderer/lib/hooks/useFeatureFlag';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { AnimatedHeight } from '@renderer/lib/ui/animated-height';
import { ComboboxTrigger, ComboboxValue } from '@renderer/lib/ui/combobox';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Switch } from '@renderer/lib/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { log } from '@renderer/utils/logger';
import {
  resolveBranchLikeTaskStrategy,
  resolvePullRequestTaskStrategy,
} from './create-task-strategy';
import { FromBranchContent } from './from-branch-content';
import { FromIssueContent } from './from-issue-content';
import { FromPrContent } from './from-pr-content';
import { useInitialConversationState } from './initial-conversation-section';
import { useFromBranchMode } from './use-from-branch-mode';
import { useFromIssueMode } from './use-from-issue-mode';
import { useFromPullRequestMode } from './use-from-pull-request-mode';

type CreateTaskStrategy = 'from-branch' | 'from-issue' | 'from-pull-request';

function issuePromptKey(issue: Issue): string {
  return issue.url || `${issue.provider}:${issue.identifier}`;
}

function prPromptKey(pr: PullRequest): string {
  return pr.url || `${pr.repositoryUrl}:${pr.identifier ?? pr.headRefName}:${pr.headRefOid}`;
}

export const CreateTaskModal = observer(function CreateTaskModal({
  projectId,
  strategy = 'from-branch',
  initialIssue,
  initialPR,
  onClose,
}: BaseModalProps & {
  projectId?: string;
  strategy?: CreateTaskStrategy;
  initialIssue?: Issue;
  initialPR?: PullRequest;
}) {
  const { t } = useTranslation();
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(() => {
    if (projectId) return projectId;
    const nav = appState.navigation;
    const navProjectId =
      nav.currentViewId === 'task'
        ? (nav.viewParamsStore['task'] as { projectId?: string } | undefined)?.projectId
        : nav.currentViewId === 'project'
          ? (nav.viewParamsStore['project'] as { projectId?: string } | undefined)?.projectId
          : undefined;
    return (
      navProjectId ??
      Array.from(getProjectManagerStore().projects.values())
        .reverse()
        .find((p) => p.state === 'mounted')?.data?.id
    );
  });
  const [selectedStrategy, setSelectedStrategy] = useState<CreateTaskStrategy>(strategy);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [useBYOI, setUseBYOI] = useState(false);

  const projectData = selectedProjectId
    ? mountedProjectData(getProjectManagerStore().projects.get(selectedProjectId))
    : null;
  const connectionId = projectData?.type === 'ssh' ? projectData.connectionId : undefined;

  const initialConversation = useInitialConversationState(connectionId);
  const lastAutoPromptRef = useRef<string | null>(null);
  const [promptedIssueKey, setPromptedIssueKey] = useState<string | null>(null);
  const [promptedPrKey, setPromptedPrKey] = useState<string | null>(null);

  useEffect(() => setUseBYOI(false), [selectedProjectId]);
  useEffect(() => {
    initialConversation.setRuntime(null);
    initialConversation.setPrompt('');
    lastAutoPromptRef.current = null;
    setPromptedIssueKey(null);
    setPromptedPrKey(null);
    // setRuntime and setPrompt are stable useState setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  const isWorkspaceProviderEnabled = useFeatureFlag('workspace-provider');
  useEffect(() => {
    if (!isWorkspaceProviderEnabled) setUseBYOI(false);
  }, [isWorkspaceProviderEnabled]);

  const repo = selectedProjectId ? getRepositoryStore(selectedProjectId) : undefined;
  const defaultBranch = repo?.defaultBranch;
  const isUnborn = repo?.isUnborn ?? false;
  const currentBranch = repo?.currentBranch ?? null;
  const { navigate } = useNavigate();

  const repositoryUrl = selectedProjectId
    ? (getRepositoryStore(selectedProjectId)?.repositoryUrl ?? undefined)
    : undefined;

  const fromBranch = useFromBranchMode(
    selectedProjectId,
    defaultBranch,
    isUnborn,
    currentBranch,
    initialConversation.prompt
  );
  const fromIssue = useFromIssueMode(
    selectedProjectId,
    defaultBranch,
    isUnborn,
    currentBranch,
    initialIssue
  );
  const fromPR = useFromPullRequestMode(selectedProjectId, defaultBranch, isUnborn, initialPR);
  const fromPrUnavailable = selectedStrategy === 'from-pull-request' && !repositoryUrl;

  useEffect(() => {
    const issue = selectedStrategy === 'from-issue' ? fromIssue.linkedIssue : null;
    const key = issue ? issuePromptKey(issue) : null;
    if (!issue || !key) {
      if (promptedIssueKey !== null) setPromptedIssueKey(null);
      return;
    }

    if (key === promptedIssueKey) return;

    const nextPrompt = formatIssueFixPrompt(issue);
    const currentPrompt = initialConversation.prompt;
    if (currentPrompt.trim().length === 0 || currentPrompt === lastAutoPromptRef.current) {
      initialConversation.setPrompt(nextPrompt);
      lastAutoPromptRef.current = nextPrompt;
    }
    setPromptedIssueKey(key);
  }, [fromIssue.linkedIssue, initialConversation, promptedIssueKey, selectedStrategy]);

  useEffect(() => {
    const pr = selectedStrategy === 'from-pull-request' ? fromPR.linkedPR : null;
    const key = pr ? prPromptKey(pr) : null;
    if (!pr || !key) {
      if (promptedPrKey !== null) setPromptedPrKey(null);
      return;
    }

    if (key === promptedPrKey) return;

    const nextPrompt = formatPullRequestReviewPrompt(pr);
    const currentPrompt = initialConversation.prompt;
    if (currentPrompt.trim().length === 0 || currentPrompt === lastAutoPromptRef.current) {
      initialConversation.setPrompt(nextPrompt);
      lastAutoPromptRef.current = nextPrompt;
    }
    setPromptedPrKey(key);
  }, [fromPR.linkedPR, initialConversation, promptedPrKey, selectedStrategy]);

  const activeMode = {
    'from-branch': fromBranch,
    'from-issue': fromIssue,
    'from-pull-request': fromPR,
  }[selectedStrategy];
  const canCreate = !!selectedProjectId && activeMode.isValid && !fromPrUnavailable;

  const handleCreateTask = useCallback(() => {
    if (!selectedProjectId) return;
    const id = crypto.randomUUID();
    const projectStore = getProjectManagerStore().projects.get(selectedProjectId);
    if (projectStore?.state !== 'mounted') return;

    const builtInitialConversation = initialConversation.runtime
      ? {
          id: crypto.randomUUID(),
          projectId: selectedProjectId,
          taskId: id,
          runtime: initialConversation.runtime,
          title: initialConversationTitle(
            initialConversation.runtime,
            initialConversation.prompt,
            []
          ),
          initialPrompt: initialConversation.prompt.trim() || undefined,
        }
      : undefined;
    const taskManager = projectStore.mountedProject!.taskManager;
    const startCreateTask = (params: CreateTaskParams) => {
      void taskManager.createTask(params).catch((error: unknown) => {
        log.warn('CreateTaskModal: task creation failed after modal close', {
          taskId: params.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    };

    switch (selectedStrategy) {
      case 'from-branch': {
        if (!fromBranch.selectedBranch) return;
        const taskStrategy = resolveBranchLikeTaskStrategy({
          isUnborn,
          createBranchAndWorktree: fromBranch.createBranchAndWorktree,
          taskBranch: fromBranch.taskName,
          pushBranch: fromBranch.pushBranch,
        });
        startCreateTask({
          id,
          projectId: selectedProjectId,
          name: fromBranch.taskName,
          sourceBranch: fromBranch.selectedBranch,
          strategy: useBYOI ? { kind: 'no-worktree' } : taskStrategy,
          workspaceProvider: useBYOI ? 'byoi' : undefined,
          initialConversation: builtInitialConversation,
        });
        break;
      }
      case 'from-issue': {
        if (!fromIssue.selectedBranch) return;
        const taskStrategy = resolveBranchLikeTaskStrategy({
          isUnborn,
          createBranchAndWorktree: fromIssue.createBranchAndWorktree,
          taskBranch: fromIssue.taskName,
          pushBranch: fromIssue.pushBranch,
        });
        startCreateTask({
          id,
          projectId: selectedProjectId,
          name: fromIssue.taskName,
          sourceBranch: fromIssue.selectedBranch,
          strategy: useBYOI ? { kind: 'no-worktree' } : taskStrategy,
          linkedIssue: fromIssue.linkedIssue ?? undefined,
          workspaceProvider: useBYOI ? 'byoi' : undefined,
          initialConversation: builtInitialConversation,
        });
        break;
      }
      case 'from-pull-request': {
        if (!fromPR.linkedPR) return;
        const reviewBranch = fromPR.linkedPR.headRefName;
        const taskStrategy = resolvePullRequestTaskStrategy({
          checkoutMode: fromPR.checkoutMode,
          prNumber: getPrNumber(fromPR.linkedPR) ?? 0,
          headBranch: reviewBranch,
          headRepositoryUrl: fromPR.linkedPR.headRepositoryUrl,
          isFork: isForkPr(fromPR.linkedPR),
          taskBranch: fromPR.taskName,
          pushBranch: fromPR.branchSelection.pushBranch,
        });
        startCreateTask({
          id,
          projectId: selectedProjectId,
          name: fromPR.taskName,
          sourceBranch: { type: 'local', branch: reviewBranch },
          initialStatus:
            fromPR.linkedPR.status === 'open' && !fromPR.linkedPR.isDraft ? 'review' : undefined,
          strategy: useBYOI ? { kind: 'no-worktree' } : taskStrategy,
          workspaceProvider: useBYOI ? 'byoi' : undefined,
          initialConversation: builtInitialConversation,
        });
        break;
      }
    }

    navigate('task', { projectId: selectedProjectId, taskId: id });
    onClose();
  }, [
    selectedProjectId,
    selectedStrategy,
    fromBranch,
    fromIssue,
    fromPR,
    isUnborn,
    useBYOI,
    initialConversation,
    navigate,
    onClose,
  ]);

  return (
    <>
      <DialogHeader className="flex items-center gap-2">
        <ProjectSelector
          value={selectedProjectId}
          onChange={setSelectedProjectId}
          trigger={
            <ComboboxTrigger className="h-6 flex items-center gap-2 border border-border rounded-md px-2.5 py-1 text-sm outline-none">
              <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
              <ComboboxValue placeholder={t('projects.selectProject')} />
            </ComboboxTrigger>
          }
        />
        <ChevronRight className="size-3.5 text-foreground-passive" />
        <DialogTitle>{t('tasks.createTask')}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="gap-4">
        <ToggleGroup
          className="w-full"
          value={[selectedStrategy]}
          onValueChange={([value]) => {
            if (value) {
              setSelectedStrategy(value as CreateTaskStrategy);
            }
          }}
        >
          <ToggleGroupItem className="flex-1" value="from-branch">
            {t('tasks.create.fromBranch')}
          </ToggleGroupItem>
          <ToggleGroupItem className="flex-1" value="from-issue">
            {t('tasks.create.fromIssue')}
          </ToggleGroupItem>
          <ToggleGroupItem className="flex-1" value="from-pull-request">
            {t('tasks.create.fromPullRequest')}
          </ToggleGroupItem>
        </ToggleGroup>
        {isWorkspaceProviderEnabled && (
          <div className="flex items-center gap-2">
            <Switch size="sm" checked={useBYOI} onCheckedChange={setUseBYOI} />
            <span className="text-sm text-muted-foreground">{t('tasks.create.useByoi')}</span>
          </div>
        )}
        <AnimatedHeight onAnimatingChange={setIsTransitioning}>
          {selectedStrategy === 'from-branch' && (
            <FromBranchContent
              state={fromBranch}
              projectId={selectedProjectId}
              currentBranch={currentBranch}
              isUnborn={isUnborn}
              initialConversation={initialConversation}
              connectionId={connectionId}
            />
          )}
          {selectedStrategy === 'from-issue' && (
            <FromIssueContent
              state={fromIssue}
              projectId={selectedProjectId}
              currentBranch={currentBranch}
              repositoryUrl={repositoryUrl}
              projectPath={projectData?.path}
              disabled={isTransitioning}
              isUnborn={isUnborn}
              initialConversation={initialConversation}
              connectionId={connectionId}
            />
          )}
          {selectedStrategy === 'from-pull-request' && (
            <div className="flex flex-col gap-3">
              {!repositoryUrl && (
                <p className="text-sm text-muted-foreground">
                  {t('pullRequests.unavailableDescription')}
                </p>
              )}
              <FromPrContent
                state={fromPR}
                projectId={selectedProjectId}
                repositoryUrl={repositoryUrl}
                disabled={isTransitioning || fromPrUnavailable}
                initialConversation={initialConversation}
                connectionId={connectionId}
              />
            </div>
          )}
        </AnimatedHeight>
      </DialogContentArea>
      <DialogFooter>
        <ConfirmButton size="sm" onClick={handleCreateTask} disabled={!canCreate}>
          {t('common.create')}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
