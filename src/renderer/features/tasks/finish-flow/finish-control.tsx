import {
  Archive,
  Bot,
  Check,
  FileDiff,
  GitMerge,
  GitPullRequest,
  MoveRight,
  Play,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { MergeTaskBranchError, MergeTaskBranchSuccess } from '@shared/task-merge';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { archiveTaskOnServer } from '@renderer/features/tasks/archive-task';
import {
  buildAcceptanceReviewPrompt,
  buildSmartMergePrompt,
} from '@renderer/features/tasks/finish-flow/finish-prompts';
import { useTaskStats } from '@renderer/features/tasks/hooks/useTaskStats';
import type { ProvisionedTask } from '@renderer/features/tasks/stores/task';
import { getRegisteredTaskData } from '@renderer/features/tasks/stores/task-selectors';
import {
  useRequireProvisionedTask,
  useTaskViewContext,
} from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { MicroLabel } from '@renderer/lib/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Spinner } from '@renderer/lib/ui/spinner';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import { log } from '@renderer/utils/logger';
import { cn } from '@renderer/utils/utils';

/**
 * Titlebar finish CTA for worktree tasks — the "merge is the new archive"
 * entry point. State-aware: hidden while any agent session is still running,
 * appears once the task is idle with a live diff, and flips to an archive
 * affordance after the work has been merged (locally or via PR).
 *
 * The popover walks the three finish concerns in order: review (acceptance),
 * merge (quick local squash / PR / agent-assisted conflict resolution), and
 * archive (which also tears down the worktree).
 */
export const TaskFinishControl = observer(function TaskFinishControl() {
  const { t } = useTranslation();
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = useRequireProvisionedTask();
  const { data: stats } = useTaskStats(projectId, taskId);
  const [open, setOpen] = useState(false);
  const [merged, setMerged] = useState<MergeTaskBranchSuccess | null>(null);

  const taskData = getRegisteredTaskData(projectId, taskId);
  const sourceBranch = taskData?.sourceBranch;

  // Branch mode only: an in-place task has no merge step — closing is enough.
  if (!provisioned?.taskBranch || sourceBranch?.type !== 'local') return null;

  // Don't compete with a running agent for attention.
  const agentStatus = provisioned.conversations.taskStatus;
  if (agentStatus === 'working' || agentStatus === 'awaiting-input') return null;

  const diff = stats?.diff;
  const hasLiveDiff = diff?.source === 'live' && diff.additions + diff.deletions > 0;
  const prMerged = provisioned.workspace.pr.currentPr?.status === 'merged';
  const isMerged = merged !== null || prMerged;
  if (!hasLiveDiff && !isMerged) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors',
              isMerged
                ? 'border-border bg-background text-foreground-muted hover:bg-background-1 hover:text-foreground'
                : 'border-border bg-background text-foreground hover:bg-background-1'
            )}
          >
            {isMerged ? (
              <>
                <Check className="size-3 shrink-0 text-foreground-diff-added" />
                <span>{t('tasks.finish.archiveCta')}</span>
              </>
            ) : (
              <>
                <GitMerge className="size-3 shrink-0" />
                <span>{t('tasks.finish.cta')}</span>
                {hasLiveDiff && diff ? (
                  <span className="flex items-center gap-1 tabular-nums">
                    <span className="text-foreground-diff-added">+{diff.additions}</span>
                    <span className="text-foreground-diff-deleted">-{diff.deletions}</span>
                  </span>
                ) : null}
              </>
            )}
          </button>
        }
      />
      <PopoverContent align="end" side="bottom" sideOffset={6} className="w-80 gap-0 p-0">
        <FinishPanel
          provisioned={provisioned}
          projectId={projectId}
          taskId={taskId}
          taskName={taskData?.name ?? ''}
          taskBranch={provisioned.taskBranch}
          baseBranch={sourceBranch.branch}
          merged={merged}
          prMerged={prMerged}
          onMerged={setMerged}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
});

const FinishPanel = observer(function FinishPanel({
  provisioned,
  projectId,
  taskId,
  taskName,
  taskBranch,
  baseBranch,
  merged,
  prMerged,
  onMerged,
  onClose,
}: {
  provisioned: ProvisionedTask;
  projectId: string;
  taskId: string;
  taskName: string;
  taskBranch: string;
  baseBranch: string;
  merged: MergeTaskBranchSuccess | null;
  prMerged: boolean;
  onMerged: (result: MergeTaskBranchSuccess) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const showCreatePrModal = useShowModal('createPrModal');
  const { value: defaultRuntime } = useAppSettingsKey('defaultRuntime');

  const [commitMessage, setCommitMessage] = useState('');
  const [generating, setGenerating] = useState(false);
  const [merging, setMerging] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [startingSession, setStartingSession] = useState(false);
  const [archiveAfterMerge, setArchiveAfterMerge] = useState(true);
  const [mergeError, setMergeError] = useState<MergeTaskBranchError | null>(null);

  const currentPr = provisioned.workspace.pr.currentPr;
  const runScript = provisioned.workspace.lifecycleScripts.tabs.find(
    (script) => script.data.type === 'run'
  );
  const isMerged = merged !== null || prMerged;

  const openChanges = () => {
    provisioned.taskView.openSidebarGroup('changes');
    provisioned.taskView.setSidebarCollapsed(false);
    onClose();
  };

  const startRunScript = () => {
    if (!runScript) return;
    if (!runScript.isRunning) {
      runScript.markRunning();
      void rpc.terminals
        .runLifecycleScript({ projectId, workspaceId: provisioned.workspaceId, type: 'run' })
        .catch(() => runScript.markExited());
    }
    provisioned.taskView.setTerminalDrawerOpen(true);
    onClose();
  };

  const startAgentSession = async (title: string, prompt: string) => {
    if (!defaultRuntime || startingSession) return;
    setStartingSession(true);
    try {
      const id = crypto.randomUUID();
      await provisioned.conversations.createConversation({
        id,
        projectId,
        taskId,
        runtime: defaultRuntime,
        title,
        initialPrompt: prompt,
      });
      provisioned.conversations.conversations.get(id)?.setWorking({ force: true });
      provisioned.taskView.tabManager.openConversation(id);
      onClose();
    } catch (error) {
      log.warn('FinishPanel: failed to start agent session', { taskId, error });
    } finally {
      setStartingSession(false);
    }
  };

  const generateCommitMessage = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const result = await rpc.tasks.generateTaskCommitMessage(projectId, taskId);
      if (result.success) setCommitMessage(result.data.message);
      else setMergeError({ kind: 'git-error', detail: result.error });
    } finally {
      setGenerating(false);
    }
  };

  const archiveNow = async () => {
    setArchiving(true);
    try {
      await archiveTaskOnServer(projectId, taskId);
      onClose();
    } finally {
      setArchiving(false);
    }
  };

  const merge = async () => {
    if (merging || !commitMessage.trim()) return;
    setMergeError(null);
    setMerging(true);
    try {
      const result = await rpc.tasks.mergeTaskBranch(projectId, taskId, {
        commitMessage: commitMessage.trim(),
      });
      if (!result.success) {
        setMergeError(result.error);
        return;
      }
      onMerged(result.data);
      if (archiveAfterMerge) await archiveNow();
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="flex flex-col text-sm">
      {/* Header: what is being finished, where it lands. */}
      <div className="flex flex-col gap-1 px-3.5 pt-3 pb-2.5">
        <span className="font-medium">{t('tasks.finish.title')}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-foreground-muted">
          <span className="truncate font-mono">{taskBranch}</span>
          <MoveRight className="size-3 shrink-0 text-foreground-passive" />
          <span className="shrink-0 font-mono">{baseBranch}</span>
        </span>
      </div>

      {/* Review — verify before anything lands on the base branch. */}
      <Section label={t('tasks.finish.review')}>
        <ActionRow icon={<FileDiff className="size-3.5" />} onClick={openChanges}>
          {t('tasks.finish.viewChanges')}
        </ActionRow>
        {runScript ? (
          <ActionRow
            icon={<Play className="size-3.5" />}
            onClick={startRunScript}
            trailing={
              runScript.isRunning ? (
                <span className="flex items-center gap-1.5 text-xs text-green-700">
                  <span className="size-1.5 rounded-full bg-green-500" />
                  {t('tasks.finish.runScriptRunning')}
                </span>
              ) : null
            }
          >
            {t('tasks.finish.runScript')}
          </ActionRow>
        ) : null}
        <ActionRow
          icon={<ShieldCheck className="size-3.5" />}
          disabled={startingSession || !defaultRuntime}
          onClick={() =>
            void startAgentSession(
              t('tasks.finish.aiReviewSessionTitle'),
              buildAcceptanceReviewPrompt({ taskName, taskBranch, baseBranch })
            )
          }
        >
          {t('tasks.finish.aiReview')}
        </ActionRow>
      </Section>

      {/* Merge — quick local squash, or the PR route. */}
      <Section label={t('tasks.finish.merge')}>
        {merged ? (
          <MergeSuccess merged={merged} t={t} />
        ) : prMerged ? (
          <div className="flex items-center gap-2 rounded-md bg-background-2 px-2.5 py-2 text-xs text-foreground-muted">
            <Check className="size-3.5 shrink-0 text-foreground-diff-added" />
            {t('tasks.finish.prMerged')}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <MicroLabel>{t('tasks.finish.commitMessage')}</MicroLabel>
              <button
                type="button"
                className="flex h-5 items-center gap-1 rounded px-1.5 text-xs text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                disabled={generating}
                onClick={() => void generateCommitMessage()}
              >
                {generating ? <Spinner className="size-3" /> : <Sparkles className="size-3" />}
                {t('tasks.finish.generateCommitMessage')}
              </button>
            </div>
            <Textarea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder={t('tasks.finish.commitMessagePlaceholder')}
              rows={2}
              className="min-h-14 resize-none font-mono text-xs"
            />
            <Button
              size="sm"
              className="w-full"
              disabled={merging || !commitMessage.trim()}
              onClick={() => void merge()}
            >
              {merging ? <Spinner className="size-3.5" /> : <GitMerge className="size-3.5" />}
              {t('tasks.finish.mergeInto', { branch: baseBranch })}
            </Button>
            {mergeError ? (
              <MergeErrorNote
                error={mergeError}
                startingSession={startingSession}
                onSmartMerge={() =>
                  void startAgentSession(
                    t('tasks.finish.smartMergeSessionTitle'),
                    buildSmartMergePrompt({
                      taskBranch,
                      baseBranch,
                      conflictDetail: mergeError.kind === 'merge-conflict' ? mergeError.detail : '',
                    })
                  )
                }
              />
            ) : null}
            {currentPr ? (
              <ActionRow
                icon={<GitPullRequest className="size-3.5" />}
                onClick={() => void rpc.app.openExternal(currentPr.url)}
              >
                {t('tasks.finish.viewPr')}
              </ActionRow>
            ) : (
              <ActionRow
                icon={<GitPullRequest className="size-3.5" />}
                onClick={() => {
                  showCreatePrModal({
                    repositoryUrl: provisioned.repositoryStore.repositoryUrl ?? '',
                    branchName: taskBranch,
                    draft: false,
                    workspaceId: provisioned.workspaceId,
                    onSuccess: () => {},
                  });
                  onClose();
                }}
              >
                {t('tasks.finish.createPr')}
              </ActionRow>
            )}
          </>
        )}
      </Section>

      {/* Archive — the lifecycle endpoint; also removes the worktree. */}
      <Section label={t('tasks.finish.archive')}>
        {!isMerged ? (
          <label className="flex cursor-pointer items-center justify-between gap-2 text-xs text-foreground-muted">
            {t('tasks.finish.archiveAfterMerge')}
            <Switch size="sm" checked={archiveAfterMerge} onCheckedChange={setArchiveAfterMerge} />
          </label>
        ) : null}
        <Button
          size="sm"
          variant={isMerged ? 'default' : 'outline'}
          className="w-full"
          disabled={archiving}
          onClick={() => void archiveNow()}
        >
          {archiving ? <Spinner className="size-3.5" /> : <Archive className="size-3.5" />}
          {t('tasks.finish.archiveTask')}
        </Button>
      </Section>
    </div>
  );
});

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-border px-3.5 py-2.5">
      <MicroLabel>{label}</MicroLabel>
      {children}
    </div>
  );
}

function ActionRow({
  icon,
  children,
  trailing,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-full items-center justify-between gap-2 rounded-md px-1.5 text-left text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="shrink-0">{icon}</span>
        <span className="truncate text-xs">{children}</span>
      </span>
      {trailing}
    </button>
  );
}

function MergeSuccess({
  merged,
  t,
}: {
  merged: MergeTaskBranchSuccess;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-background-2 px-2.5 py-2 text-xs">
      <Check className="size-3.5 shrink-0 text-foreground-diff-added" />
      <span className="min-w-0 truncate text-foreground-muted">
        {t('tasks.finish.mergedInto', { branch: merged.baseBranch })}
      </span>
      <span className="ml-auto shrink-0 font-mono text-foreground-passive">
        {merged.commitHash.slice(0, 7)}
      </span>
    </div>
  );
}

function MergeErrorNote({
  error,
  startingSession,
  onSmartMerge,
}: {
  error: MergeTaskBranchError;
  startingSession: boolean;
  onSmartMerge: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-background-destructive px-2.5 py-2">
      <span className="text-xs text-foreground-destructive">{mergeErrorText(error, t)}</span>
      {error.kind === 'merge-conflict' ? (
        <button
          type="button"
          disabled={startingSession}
          onClick={onSmartMerge}
          className="flex h-6 items-center gap-1.5 self-start rounded border border-border-destructive px-1.5 text-xs text-foreground-destructive transition-colors hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50"
        >
          <Bot className="size-3" />
          {t('tasks.finish.smartMerge')}
        </button>
      ) : null}
    </div>
  );
}

function mergeErrorText(
  error: MergeTaskBranchError,
  t: ReturnType<typeof useTranslation>['t']
): string {
  switch (error.kind) {
    case 'no-task-branch':
    case 'no-worktree':
    case 'no-base-branch':
      return t('tasks.finish.errorNotMergeable');
    case 'nothing-to-merge':
      return t('tasks.finish.errorNothingToMerge');
    case 'base-not-checked-out':
      return t('tasks.finish.errorBaseNotCheckedOut', {
        branch: error.baseBranch,
        current: error.currentBranch ?? '?',
      });
    case 'base-dirty':
      return t('tasks.finish.errorBaseDirty', { branch: error.baseBranch });
    case 'merge-conflict':
      return t('tasks.finish.errorConflict', { branch: error.baseBranch });
    case 'git-error':
      return error.detail;
    default: {
      const _exhaustive: never = error;
      return _exhaustive;
    }
  }
}
