import type { QueryClient } from '@tanstack/react-query';
import type { Agent } from '@shared/agents';
import type { Branch } from '@shared/git';
import type { ParadigmStamp } from '@shared/paradigms/stamp';
import type { RuntimeId } from '@shared/runtime-registry';
import { ensureUniqueTaskDisplayName } from '@shared/task-name';
import { resolveAgentSlot } from '@renderer/app/agent-slot-resolution';
import {
  branchNeedsCheckout,
  type HomeProjectSubmitStrategy,
} from '@renderer/app/home-project-submit';
import type { MountedProject } from '@renderer/features/projects/stores/project';
import type { ProjectManagerStore } from '@renderer/features/projects/stores/project-manager';
import { asMounted } from '@renderer/features/projects/stores/project-selectors';
import { initialConversationTitle } from '@renderer/features/tasks/conversations/conversation-title-utils';
import type { ProvisionedTask } from '@renderer/features/tasks/stores/task';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { agentRuntimeSettings, agentSkillSelection } from './agent-launch-settings';
import type {
  LaunchedParadigmAgent,
  ParadigmAgentLaunchRequest,
  ParadigmLaunchContext,
  ParadigmLaunchTarget,
  ParadigmVariantLaunchRequest,
} from './launch-context';

export interface CreateParadigmLaunchContextArgs {
  target: ParadigmLaunchTarget;
  requirement: string;
  titlePrompt: string | undefined;
  deferInitialPrompt: boolean;
  /** Resolves to the rewritten requirement, or null when the rewrite failed. */
  requirementPromise: Promise<string | null>;
  baseName: string;
  imagePaths: string[] | undefined;
  /** Images handed to the initial conversation; undefined when deferred. */
  sessionImagePaths: string[] | undefined;
  strategyKind: HomeProjectSubmitStrategy;
  /** Recorded on every task this launch creates, so the canvas knows what drives it. */
  paradigm: ParadigmStamp;
  agents: Agent[];
  slotAgentId: (slotKey: string) => string | null;
  /** Runtime a slot falls back to when its Agent follows the composer default. */
  composerRuntime: RuntimeId | null;
  /** The task being joined — required for the `existing-task` target. */
  provisionedTask: ProvisionedTask | null;
  /** The project tasks are created in — required for the `new-task` target. */
  project: MountedProject | null;
  selectedBranch: Branch | undefined;
  baseDefaultBranch: Branch | undefined;
  currentBranchName: string | null;
  /** Branch the parent task occupies, when this task continues from one. */
  parentBranchName: string | null;
  parentTaskId: string | undefined;
  projectManager: ProjectManagerStore;
  queryClient: QueryClient;
  /** Whether the runtime's selected permission tier auto-approves. */
  isAutoApproving: (runtime: RuntimeId) => boolean;
  t: (key: string) => string;
  /** Reveals a newly created task and reports it to the composer's host. */
  focusTask: (projectId: string, taskId: string) => void;
  onConversationsStarted: (projectId: string, taskId: string, conversationIds: string[]) => void;
  resetComposer: () => void;
}

/**
 * Builds the services a paradigm launches through. Every difference between
 * "start a new task" and "join the task I am already in" is resolved here, so a
 * paradigm has one implementation instead of one per surface.
 */
export function createParadigmLaunchContext(
  args: CreateParadigmLaunchContextArgs
): ParadigmLaunchContext {
  const {
    target,
    requirement,
    deferInitialPrompt,
    requirementPromise,
    imagePaths,
    sessionImagePaths,
  } = args;
  const joinedTask = target.kind === 'existing-task' ? target : null;
  const createdConversationIds: string[] = [];

  const requireProject = (): MountedProject => {
    if (!args.project) {
      throw new Error(`Paradigm launch target "${target.kind}" has no mounted project.`);
    }
    return args.project;
  };
  const requireJoinedTask = (): ProvisionedTask => {
    if (!args.provisionedTask) {
      throw new Error('Paradigm launch targets a task that is not provisioned.');
    }
    return args.provisionedTask;
  };

  // Conversation titles are deduplicated against the task's existing sessions;
  // a fresh task starts from an empty list.
  const conversationTitleInputs = joinedTask
    ? Array.from(requireJoinedTask().conversations.conversations.values(), (conversation) => ({
        runtimeId: conversation.data.runtimeId,
        title: conversation.data.title,
      }))
    : [];
  const reservedNames = args.project
    ? Array.from(args.project.taskManager.tasks.values(), (task) => task.data.name)
    : [];
  const reserveTaskName = (seed: string): string => {
    const taskName = ensureUniqueTaskDisplayName(seed, reservedNames);
    reservedNames.push(taskName);
    return taskName;
  };

  const showDeferredPromptWaitToast = () => {
    let toastId: ReturnType<typeof toast.loading> | undefined;
    const timer = setTimeout(() => {
      toastId = toast.loading(args.t('home.promptTranslationWaiting'), {
        description: args.t('home.promptTranslationWaitingDescription'),
      });
    }, 350);
    return () => {
      clearTimeout(timer);
      if (toastId !== undefined) toast.dismiss(toastId);
    };
  };

  const injectDeferredPrompt = async (
    launch: LaunchedParadigmAgent,
    buildPrompt: (requirement: string) => string | undefined
  ): Promise<string | null> => {
    const dismissWaitToast = showDeferredPromptWaitToast();
    try {
      const rewritten = await requirementPromise;
      if (rewritten === null) return null;
      const sent = await rpc.conversations.injectConversationPrompt({
        projectId: launch.projectId,
        taskId: launch.taskId,
        conversationId: launch.conversationId,
        runtime: launch.runtime,
        prompt: buildPrompt(rewritten),
        imagePaths,
      });
      if (sent) return rewritten;
      toast.error(args.t('home.promptSendFailed'));
      return null;
    } catch {
      toast.error(args.t('home.promptSendFailed'));
      return null;
    } finally {
      dismissWaitToast();
    }
  };

  const createJoinedConversation = (
    request: ParadigmAgentLaunchRequest,
    task: ProvisionedTask,
    joined: { projectId: string; taskId: string }
  ): LaunchedParadigmAgent => {
    const provider = request.slot.provider;
    const initialPrompt = request.buildPrompt(requirement);
    const conversationId = crypto.randomUUID();
    const title = initialConversationTitle(
      provider,
      args.titlePrompt ?? initialPrompt,
      conversationTitleInputs
    );
    conversationTitleInputs.push({ runtimeId: provider, title });
    createdConversationIds.push(conversationId);
    const promise = task.conversations.createConversation({
      id: conversationId,
      projectId: joined.projectId,
      taskId: joined.taskId,
      runtime: provider,
      title,
      initialPrompt,
      deferInitialPrompt,
      imagePaths: sessionImagePaths,
      ...agentRuntimeSettings(request.slot.agent, provider),
      skillSelection: agentSkillSelection(request.slot.agent),
    });
    return { ...joined, conversationId, runtime: provider, promise };
  };

  const taskStrategy = (kind: HomeProjectSubmitStrategy, taskName: string) =>
    kind === 'no-worktree'
      ? ({ kind: 'no-worktree' } as const)
      : kind === 'checkout-existing'
        ? ({ kind: 'checkout-existing' } as const)
        : ({ kind: 'new-branch', taskBranch: taskName, pushBranch: false } as const);

  /**
   * `no-worktree` runs in the project itself, so it continues from the parent
   * task's branch when there is one; the worktree strategies fork from the
   * branch the composer selected.
   */
  const taskSourceBranch = (kind: HomeProjectSubmitStrategy): Branch => {
    if (kind === 'no-worktree' && args.parentBranchName) {
      return { type: 'local', branch: args.parentBranchName };
    }
    const source = args.selectedBranch ?? args.baseDefaultBranch;
    if (!source) {
      throw new Error(`Paradigm launch target "${target.kind}" has no source branch.`);
    }
    return source;
  };

  const createOwnTask = (request: ParadigmAgentLaunchRequest): LaunchedParadigmAgent => {
    const project = requireProject();
    const provider = request.slot.provider;
    const initialPrompt = request.buildPrompt(requirement);
    const taskId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    const taskName = reserveTaskName(request.nameSeed ?? args.baseName);
    const promise = project.taskManager.createTask({
      id: taskId,
      projectId: project.data.id,
      name: taskName,
      sourceBranch: taskSourceBranch(args.strategyKind),
      strategy: taskStrategy(args.strategyKind, taskName),
      parentTaskId: args.parentTaskId,
      paradigm: args.paradigm,
      quickActionSource: request.quickActionSource
        ? { ...request.quickActionSource, conversationId }
        : undefined,
      initialConversation: {
        id: conversationId,
        projectId: project.data.id,
        taskId,
        runtime: provider,
        title: initialConversationTitle(provider, args.titlePrompt ?? initialPrompt, []),
        initialPrompt,
        deferInitialPrompt,
        imagePaths: sessionImagePaths,
        ...agentRuntimeSettings(request.slot.agent, provider),
        skillSelection: agentSkillSelection(request.slot.agent),
      },
    });
    return { projectId: project.data.id, taskId, conversationId, runtime: provider, promise };
  };

  return {
    target,
    requirement,
    titlePrompt: args.titlePrompt,
    deferInitialPrompt,
    baseName: args.baseName,
    imagePaths,
    strategyKind: args.strategyKind,
    t: args.t,
    queryClient: args.queryClient,
    isAutoApproving: args.isAutoApproving,

    resolveSlot(slotKey, fallbackRuntime) {
      return resolveAgentSlot({
        selectedAgentId: args.slotAgentId(slotKey),
        agents: args.agents,
        fallbackRuntime: fallbackRuntime === undefined ? args.composerRuntime : fallbackRuntime,
      });
    },

    launchAgent(request) {
      return joinedTask
        ? createJoinedConversation(request, requireJoinedTask(), joinedTask)
        : createOwnTask(request);
    },

    launchBareTask(request) {
      if (joinedTask) return { ...joinedTask, promise: Promise.resolve() };
      const project = requireProject();
      const taskId = crypto.randomUUID();
      const taskName = reserveTaskName(request?.nameSeed ?? args.baseName);
      const promise = project.taskManager.createTask({
        id: taskId,
        projectId: project.data.id,
        name: taskName,
        sourceBranch: taskSourceBranch(args.strategyKind),
        strategy: taskStrategy(args.strategyKind, taskName),
        parentTaskId: args.parentTaskId,
        paradigm: args.paradigm,
      });
      return { projectId: project.data.id, taskId, promise };
    },

    async launchVariant(request: ParadigmVariantLaunchRequest) {
      await args.projectManager.mountProject(request.projectId).catch(() => {});
      const project = asMounted(args.projectManager.projects.get(request.projectId));
      if (!project) return null;
      // An explicit per-variant branch wins; otherwise the routed project reuses
      // the branch already resolved for it and other projects start from their
      // own current branch.
      const routed = args.project?.data.id === request.projectId;
      let currentBranchName = routed ? args.currentBranchName : null;
      const source =
        request.baseBranch ??
        (routed
          ? (args.selectedBranch ?? args.baseDefaultBranch)
          : await rpc.repository.getLocalBranches(request.projectId).then((local) => {
              currentBranchName = local.currentBranch;
              return local.currentBranch
                ? ({ type: 'local' as const, branch: local.currentBranch } as const)
                : undefined;
            }));
      if (!source) return null;
      const provider = request.slot.provider;
      const initialPrompt = request.buildPrompt(requirement);
      const taskName = ensureUniqueTaskDisplayName(
        request.nameSeed,
        Array.from(project.taskManager.tasks.values(), (task) => task.data.name)
      );
      const taskId = crypto.randomUUID();
      const conversationId = crypto.randomUUID();
      const promise = project.taskManager.createTask({
        id: taskId,
        projectId: request.projectId,
        name: taskName,
        sourceBranch: source,
        strategy:
          request.strategyKind === 'new-branch'
            ? ({ kind: 'new-branch', taskBranch: taskName, pushBranch: false } as const)
            : branchNeedsCheckout(source, currentBranchName)
              ? ({ kind: 'checkout-existing' } as const)
              : ({ kind: 'no-worktree' } as const),
        // A variant runs the paradigm being compared, not the comparison itself,
        // so the wrapper states what each variant task actually is.
        paradigm: request.paradigm,
        initialConversation: {
          id: conversationId,
          projectId: request.projectId,
          taskId,
          runtime: provider,
          // A variant is an experiment surface with no sibling sessions, so the
          // raw requirement is a usable title seed when the prompt is empty.
          title: initialConversationTitle(
            provider,
            args.titlePrompt ?? (requirement || undefined),
            []
          ),
          initialPrompt,
          deferInitialPrompt,
          imagePaths: sessionImagePaths,
          ...agentRuntimeSettings(request.slot.agent, provider),
          skillSelection: agentSkillSelection(request.slot.agent),
        },
      });
      return { projectId: request.projectId, taskId, conversationId, runtime: provider, promise };
    },

    async resolveRequirement() {
      return deferInitialPrompt ? await requirementPromise : requirement;
    },

    scheduleDeferredPrompt(launch, buildPrompt) {
      if (!deferInitialPrompt) return;
      void launch.promise
        .then(() => injectDeferredPrompt(launch, buildPrompt))
        .catch(() => {
          // Creation failures are reported by whoever owns the launch promise.
        });
    },

    requirementForOrchestration(launch, buildPrompt) {
      return deferInitialPrompt
        ? launch.promise.then(() => injectDeferredPrompt(launch, buildPrompt))
        : launch.promise.then(() => requirement);
    },

    assertTaskReady(task) {
      if (!asProvisioned(getTaskStore(task.projectId, task.taskId))) {
        throw new Error(args.t('home.teamTaskSetupIncomplete'));
      }
    },

    focusTask(projectId, taskId) {
      // Joining a task means the composer already sits inside it.
      if (joinedTask) return;
      args.focusTask(projectId, taskId);
    },

    finish() {
      if (joinedTask) {
        void getTaskStore(joinedTask.projectId, joinedTask.taskId)?.setNeedsReview(false);
        args.onConversationsStarted(
          joinedTask.projectId,
          joinedTask.taskId,
          createdConversationIds
        );
      }
      args.resetComposer();
    },

    reportLaunchFailure(promise) {
      void promise.catch(() => {
        toast.error(
          joinedTask ? 'Agent conversation failed to start.' : 'Agent task failed to start.'
        );
      });
    },

    reportFailures(results) {
      const failures = results.filter((result) => result.status === 'rejected');
      if (failures.length === 0) return;
      const targetName = joinedTask ? 'conversation' : 'task';
      toast.error(
        failures.length === 1
          ? `One agent ${targetName} failed to start.`
          : `${failures.length} agent ${targetName}s failed to start.`
      );
    },
  };
}
