import type { Conversation } from '@shared/conversations';
import { taskProvisionProgressChannel } from '@shared/events/taskEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import type { Task } from '@shared/tasks';
import type { Terminal } from '@shared/terminals';
import {
  isConversationHydrationCancelled,
  registerConversationHydrationBarrier,
} from '@main/core/conversations/conversation-hydration-barrier';
import { withConversationOperation } from '@main/core/conversations/conversation-operation-lock';
import { getActiveConversation } from '@main/core/conversations/get-active-conversation';
import {
  hydratedConversationStart,
  shouldClearPendingInitialPromptAfterStart,
} from '@main/core/conversations/pending-initial-prompt';
import { clearPendingInitialPrompt } from '@main/core/conversations/pending-initial-prompt-store';
import type { ConversationProvider } from '@main/core/conversations/types';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { GitFetchService } from '@main/core/git/git-fetch-service';
import type { GitRepositoryService } from '@main/core/git/repository-service';
import {
  decodeTmuxSessionName,
  killTmuxSessionStrict,
  listTmuxSessionMarkers,
  listTmuxSessionMarkersStrict,
  makeTmuxSessionName,
} from '@main/core/pty/tmux-session-name';
import type { TerminalProvider } from '@main/core/terminals/terminal-provider';
import type { Workspace } from '@main/core/workspaces/workspace';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import type { ProvisionResult, TaskProvider } from '../projects/project-provider';
import type { ProjectSettingsProvider } from '../projects/settings/provider';
import { resolveTaskWorkDir } from '../projects/worktrees/utils';
import type { WorktreeService } from '../projects/worktrees/worktree-service';
import {
  buildTaskProviders,
  createWorkspaceFactory,
  resolveTaskEnv,
  type ResolvedTaskRuntime,
  type WorkspaceType,
} from '../workspaces/workspace-factory';
import { hydratePersistedTerminals } from './terminal-hydration';

export const CONVERSATION_HYDRATION_CONCURRENCY = 4;
export const CONVERSATION_TMUX_MARKER_CACHE_TTL_MS = 5_000;

type ConversationHydrationLimiter = {
  active: number;
  queue: Array<() => void>;
};

const conversationHydrationLimiter: ConversationHydrationLimiter = {
  active: 0,
  queue: [],
};

type TmuxMarkerCacheEntry = {
  value?: ReadonlySet<string>;
  sampledAt?: number;
  inFlight?: Promise<ReadonlySet<string>>;
};

const tmuxMarkerCache = new Map<string, TmuxMarkerCacheEntry>();

function acquireConversationHydrationSlot(): Promise<() => void> {
  return new Promise((resolve) => {
    const start = () => {
      conversationHydrationLimiter.active += 1;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        conversationHydrationLimiter.active -= 1;
        conversationHydrationLimiter.queue.shift()?.();
      });
    };

    if (conversationHydrationLimiter.active < CONVERSATION_HYDRATION_CONCURRENCY) {
      start();
    } else {
      conversationHydrationLimiter.queue.push(start);
    }
  });
}

async function withConversationHydrationSlot(run: () => Promise<void>): Promise<void> {
  const release = await acquireConversationHydrationSlot();
  try {
    await run();
  } finally {
    release();
  }
}

async function hydratePersistedConversation(
  provider: ConversationProvider,
  conversation: Conversation,
  logPrefix: string,
  refreshLiveSession?: (conversation: Conversation) => Promise<void>
): Promise<void> {
  await withConversationHydrationSlot(() =>
    withConversationOperation(conversation, async () => {
      if (isConversationHydrationCancelled(conversation)) return;
      const persistedConversation = await getActiveConversation(conversation);
      if (!persistedConversation || isConversationHydrationCancelled(conversation)) return;
      const pending = persistedConversation.pendingInitialPrompt;
      const start = hydratedConversationStart(persistedConversation);

      try {
        await refreshLiveSession?.(persistedConversation);
        if (isConversationHydrationCancelled(conversation)) return;
        await provider.startSession(
          persistedConversation,
          undefined,
          start.isResuming,
          start.initialPrompt,
          undefined,
          start.imagePaths,
          { model: start.model, reasoningEffort: start.reasoningEffort }
        );
        if (isConversationHydrationCancelled(conversation)) return;
        if (
          pending &&
          shouldClearPendingInitialPromptAfterStart(provider, persistedConversation.runtimeId)
        ) {
          await clearPendingInitialPrompt(persistedConversation.id, {
            projectId: persistedConversation.projectId,
            taskId: persistedConversation.taskId,
            deliveryToken: pending.deliveryToken,
          });
        }
      } catch (error) {
        log.error(`${logPrefix}: failed to hydrate conversation`, {
          conversationId: persistedConversation.id,
          error: String(error),
        });
      }
    })
  );
}

/**
 * Restore only conversations that still need their first prompt delivered, or
 * conversations whose canonical tmux pane demonstrably survived. A surviving
 * process is replaced so the resumed thread receives the current runtime
 * environment. Historical conversations without a live pane stay hibernated
 * until explicitly opened.
 */
export async function hydratePersistedConversations(
  provider: ConversationProvider,
  conversations: Conversation[],
  logPrefix: string,
  liveTmuxSessionIds: Promise<ReadonlySet<string>> = Promise.resolve(new Set()),
  refreshLiveSession?: (conversation: Conversation) => Promise<void>
): Promise<void> {
  const hasLiveCanonicalSession = (
    sessionIds: ReadonlySet<string>,
    conversation: Conversation
  ): boolean =>
    sessionIds.has(makePtySessionId(conversation.projectId, conversation.taskId, conversation.id));
  const hydrations = conversations.map((conversation) => {
    const prompt = conversation.pendingInitialPrompt;
    // A prompt that has never been attempted starts immediately. Every other
    // conversation waits for the bounded marker sample. A surviving pane is
    // replaced before resume so cold startup reads the current account and
    // runtime environment instead of inheriting the old Agent process.
    const hydration =
      prompt && prompt.attemptStartedAtMs === undefined
        ? hydratePersistedConversation(provider, conversation, logPrefix)
        : liveTmuxSessionIds.then((sessionIds) => {
            const live = hasLiveCanonicalSession(sessionIds, conversation);
            if (!prompt && !live) return;
            return hydratePersistedConversation(
              provider,
              conversation,
              logPrefix,
              live ? refreshLiveSession : undefined
            );
          });
    return registerConversationHydrationBarrier(conversation, Promise.resolve(hydration));
  });

  await Promise.all(hydrations);
}

function tmuxMarkerCacheKey(type: WorkspaceType): string {
  return type.kind === 'ssh' ? `ssh:${type.connectionId}` : 'local';
}

async function sampleLiveTmuxSessionIds(type: WorkspaceType): Promise<ReadonlySet<string>> {
  let ctx: IExecutionContext;
  try {
    ctx = type.kind === 'ssh' ? new SshExecutionContext(type.proxy) : new LocalExecutionContext();
  } catch (error) {
    log.warn('Failed to create execution context for tmux session hydration', {
      error: String(error),
    });
    return new Set();
  }

  try {
    const markers = await listTmuxSessionMarkers(ctx);
    return new Set(
      markers.flatMap((marker) => {
        const sessionId = decodeTmuxSessionName(marker.sessionName);
        return sessionId ? [sessionId] : [];
      })
    );
  } catch (error) {
    log.warn('Failed to list tmux sessions for conversation hydration', {
      error: String(error),
    });
    return new Set();
  } finally {
    ctx.dispose();
  }
}

/** Share the one bounded tmux marker query across tasks provisioned on one host. */
export function discoverLiveTmuxSessionIds(type: WorkspaceType): Promise<ReadonlySet<string>> {
  const now = Date.now();
  for (const [key, entry] of tmuxMarkerCache) {
    if (
      !entry.inFlight &&
      entry.sampledAt !== undefined &&
      now - entry.sampledAt >= CONVERSATION_TMUX_MARKER_CACHE_TTL_MS
    ) {
      tmuxMarkerCache.delete(key);
    }
  }

  const key = tmuxMarkerCacheKey(type);
  const cached = tmuxMarkerCache.get(key);
  if (cached?.inFlight) return cached.inFlight;
  if (
    cached?.value &&
    cached.sampledAt !== undefined &&
    now - cached.sampledAt < CONVERSATION_TMUX_MARKER_CACHE_TTL_MS
  ) {
    return Promise.resolve(cached.value);
  }

  const entry: TmuxMarkerCacheEntry = {};
  const sample = sampleLiveTmuxSessionIds(type);
  entry.inFlight = sample;
  tmuxMarkerCache.set(key, entry);
  void sample.then(
    (value) => {
      if (tmuxMarkerCache.get(key) !== entry) return;
      entry.value = value;
      entry.sampledAt = Date.now();
      entry.inFlight = undefined;
    },
    () => {
      if (tmuxMarkerCache.get(key) === entry) tmuxMarkerCache.delete(key);
    }
  );
  return sample;
}

async function replacePersistedConversationTmuxSession(
  type: WorkspaceType,
  conversation: Conversation
): Promise<void> {
  const ctx =
    type.kind === 'ssh' ? new SshExecutionContext(type.proxy) : new LocalExecutionContext();
  const sessionId = makePtySessionId(conversation.projectId, conversation.taskId, conversation.id);
  const sessionName = makeTmuxSessionName(sessionId);
  try {
    try {
      await killTmuxSessionStrict(ctx, sessionName);
    } catch (error) {
      let markers: Awaited<ReturnType<typeof listTmuxSessionMarkersStrict>>;
      try {
        markers = await listTmuxSessionMarkersStrict(ctx);
      } catch {
        throw error;
      }
      if (markers.some((marker) => marker.sessionName === sessionName)) throw error;
    }
  } finally {
    ctx.dispose();
  }
}

export type BuildTaskResult = {
  taskProvider: TaskProvider;
  conversationProvider: ConversationProvider;
  terminalProvider: TerminalProvider;
};

export type ProvisionLocalTaskParams = {
  task: Task;
  conversations: Conversation[];
  terminals: Terminal[];
  workspaceId: string;
  type: WorkspaceType;
  projectId: string;
  projectPath: string;
  settings: ProjectSettingsProvider;
  worktreeService: WorktreeService;
  fetchService: GitFetchService;
  repository: GitRepositoryService;
  logPrefix: string;
};

export type ProvisionLocalTaskResult = {
  provisionResult: ProvisionResult;
  workspace: Workspace;
  buildTaskResult: BuildTaskResult;
};

/**
 * Shared provision scaffolding for tasks whose workspace lives local to the
 * repository — either a worktree alongside the repo or the project root itself.
 * Works for both local and SSH transports (transport is encoded in `type`).
 *
 * Returns workspace and buildTaskResult so callers can perform their own
 * post-provision setup (e.g. git watcher registration, reconnect map population)
 * without lifecycle hook callbacks.
 */
export async function provisionLocalTask(
  params: ProvisionLocalTaskParams
): Promise<ProvisionLocalTaskResult> {
  const {
    task,
    conversations,
    terminals,
    workspaceId,
    type,
    projectId,
    projectPath,
    settings,
    worktreeService,
    fetchService,
    repository,
    logPrefix,
  } = params;

  events.emit(taskProvisionProgressChannel, {
    taskId: task.id,
    projectId,
    step: 'resolving-worktree',
    message: 'Resolving worktree…',
  });
  const workDir = await resolveTaskWorkDir(task, projectPath, worktreeService);

  events.emit(taskProvisionProgressChannel, {
    taskId: task.id,
    projectId,
    step: 'initialising-workspace',
    message: 'Initialising workspace…',
  });
  let resolvedTaskRuntime: ResolvedTaskRuntime | undefined;
  const workspace = await workspaceRegistry.acquire(
    workspaceId,
    projectId,
    createWorkspaceFactory(workspaceId, type, {
      task,
      workDir,
      projectId,
      projectPath,
      settings,
      logPrefix,
      repository,
      fetchService,
      onTaskRuntimeResolved: (runtime) => {
        resolvedTaskRuntime = runtime;
      },
    })
  );

  let provisionSucceeded = false;
  try {
    events.emit(taskProvisionProgressChannel, {
      taskId: task.id,
      projectId,
      step: 'starting-sessions',
      message: 'Starting sessions…',
    });
    const buildTaskResult = await buildTaskFromWorkspace(
      task,
      workspace,
      type,
      projectId,
      projectPath,
      settings,
      { conversations, terminals },
      logPrefix,
      resolvedTaskRuntime
    );
    log.debug(`${logPrefix}: provisionLocalTask DONE`, { taskId: task.id });
    provisionSucceeded = true;
    return {
      provisionResult: { taskProvider: buildTaskResult.taskProvider, persistData: { workspaceId } },
      workspace,
      buildTaskResult,
    };
  } finally {
    if (!provisionSucceeded) {
      await workspaceRegistry.release(workspace.id, 'terminate').catch(() => {});
    }
  }
}

/**
 * Shared tail of doProvisionTask — builds and hydrates a TaskProvider from
 * an already-acquired workspace. Works for both local and SSH transports.
 *
 * Returns all three provider objects so callers (e.g. SshProjectProvider)
 * can keep references for reconnect rehydration.
 */
export async function buildTaskFromWorkspace(
  task: Task,
  workspace: Workspace,
  type: WorkspaceType,
  projectId: string,
  projectPath: string,
  settings: ProjectSettingsProvider,
  hydrate: { conversations: Conversation[]; terminals: Terminal[] },
  logPrefix: string,
  preResolvedTaskRuntime?: ResolvedTaskRuntime
): Promise<BuildTaskResult> {
  const { taskEnvVars, tmuxEnabled, shellSetup } =
    preResolvedTaskRuntime ?? (await resolveTaskEnv(task, workspace, projectPath, settings));

  const { conversations: conversationProvider, terminals: terminalProvider } = buildTaskProviders(
    type,
    {
      projectId,
      sidebarWorkspaceId: task.sidebarWorkspaceId,
      taskId: task.id,
      taskPath: workspace.path,
      tmuxEnabled,
      shellSetup,
      taskEnvVars,
    }
  );

  const taskProvider: TaskProvider = {
    taskId: task.id,
    taskBranch: task.taskBranch,
    sourceBranch: task.sourceBranch,
    taskEnvVars,
    conversations: conversationProvider,
    terminals: terminalProvider,
  };

  await hydratePersistedTerminals(terminalProvider, hydrate.terminals, logPrefix);

  const liveTmuxSessionIds = tmuxEnabled
    ? discoverLiveTmuxSessionIds(type)
    : Promise.resolve<ReadonlySet<string>>(new Set());
  void hydratePersistedConversations(
    conversationProvider,
    hydrate.conversations,
    logPrefix,
    liveTmuxSessionIds,
    tmuxEnabled
      ? (conversation) => replacePersistedConversationTmuxSession(type, conversation)
      : undefined
  ).catch((error) => {
    log.error(`${logPrefix}: failed to hydrate persisted conversations`, {
      error: String(error),
    });
  });

  return { taskProvider, conversationProvider, terminalProvider };
}
