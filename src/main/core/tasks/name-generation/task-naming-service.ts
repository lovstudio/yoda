import { spawn } from 'node:child_process';
import { and, desc, eq, ne } from 'drizzle-orm';
import type { RuntimeCustomConfig } from '@shared/app-settings';
import { BUILTIN_AGENT_KEYS } from '@shared/builtin-agents';
import { taskNamingUpdatedChannel } from '@shared/events/taskEvents';
import { getRuntime, type RuntimeId } from '@shared/runtime-registry';
import { deriveTaskSlug, normalizeTaskDisplayName } from '@shared/task-name';
import {
  normalizeTaskNamingTimeoutMs,
  type TaskNamingContextSnapshot,
  type TaskNamingContextSource,
  type TaskNamingDebugStage,
  type TaskNamingDebugTrace,
  type TaskNamingSettings,
  type TaskNamingSnapshot,
  type TaskNamingStatus,
} from '@shared/task-naming';
import type { CreateTaskParams } from '@shared/tasks';
import { resolveSelectedUtilityAgent } from '@main/core/agents-config/builtin-agent-resolver';
import {
  resolveRuntimeBaseEnv,
  resolveRuntimeEnv,
} from '@main/core/conversations/impl/runtime-env';
import { getManualSummary, getStoredSummary } from '@main/core/conversations/session-summary-store';
import { projectManager } from '@main/core/projects/project-manager';
import type { ProjectProvider } from '@main/core/projects/project-provider';
import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import { appSettingsService } from '@main/core/settings/settings-service';
import { db } from '@main/db/client';
import { conversations, projects, taskNamingSnapshots, tasks } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { buildExternalToolEnv } from '@main/utils/childProcessEnv';
import { fromStoredBranch } from '../stored-branch';
import { buildAgentNamingCommand } from './agent-naming-command';
import {
  normalizeTaskNamingModelForProvider,
  resolvePreferredTaskNamingModel,
} from './task-naming-model';

const MAX_SOURCE_CHARS = 2_000;
const MAX_TOTAL_CONTEXT_CHARS = 6_000;
const MAX_TASK_NAME_CHARS = 36;
const MAX_SESSION_TITLE_CHARS = 48;
const MAX_BRANCH_NAME_CHARS = 48;
const MAX_COMMAND_OUTPUT_CHARS = 32_000;
const MAX_COMMAND_ERROR_CHARS = 2_000;
const README_CANDIDATES = ['README.md', 'README.mdx', 'readme.md', 'Readme.md'];

type GenerateTaskNamesInput = {
  taskId: string;
  projectId: string;
  project: ProjectProvider;
  params: CreateTaskParams;
  includeBranchName: boolean;
  /**
   * 'session' names the session from its own content (first prompt) only;
   * 'task' (default) aggregates session titles/summaries plus project sources.
   */
  target?: NamingTarget;
};

type GenerateTaskNamesResult =
  | {
      success: true;
      taskName: string | undefined;
      branchName: string | undefined;
      snapshot: TaskNamingSnapshot;
    }
  | { success: false; message: string; snapshot: TaskNamingSnapshot };

export type ModelNamingPayload = Record<string, unknown> & {
  taskName?: unknown;
  branchName?: unknown;
  sessionTitle?: unknown;
  title?: unknown;
};

export type NamingPayloadResult = {
  payload: ModelNamingPayload;
  model: string;
  method: 'agent-cli';
  stages: TaskNamingDebugStage[];
};

export type AgentNamingRuntime = {
  runtimeId: RuntimeId;
  runtimeName: string;
  providerConfig: RuntimeCustomConfig;
};

export type ResolvedNamingRuntime = {
  settings: TaskNamingSettings;
  defaultRuntime: RuntimeId;
  runtimeId: RuntimeId;
  runtimeName: string;
  providerConfig: RuntimeCustomConfig | null;
  runtime: AgentNamingRuntime | null;
  customSystemPrompt: string;
};

export type NamingTarget = 'task' | 'session';

export type NamingContextSourceDraft = Omit<
  TaskNamingContextSource,
  'content' | 'estimatedTokens'
> & {
  content?: string;
};

export type NamingPromptParts = {
  systemPrompt: string;
  systemPromptEstimatedTokens: number;
  prompt: string;
  promptEstimatedTokens: number;
};

type AgentNamingCommandResult = {
  stdout: string;
  stderrChars: number;
  firstStdoutMs: number | null;
  firstStderrMs: number | null;
  jsonEventCount: number;
  firstJsonEventMs: number | null;
  finalAgentMessageMs: number | null;
};

export async function resolveNamingRuntime(
  fallbackProviderId?: RuntimeId | null
): Promise<ResolvedNamingRuntime> {
  const [taskSettings, defaultRuntime] = await Promise.all([
    appSettingsService.get('tasks'),
    appSettingsService.get('defaultRuntime'),
  ]);
  const namingAgent = await resolveSelectedUtilityAgent(
    taskSettings.namingAgentId,
    BUILTIN_AGENT_KEYS.naming
  );
  const runtimeId = namingAgent.runtimeId ?? fallbackProviderId ?? defaultRuntime;
  const providerConfig = await runtimeOverrideSettings.getItem(runtimeId);
  const runtimeName = getRuntime(runtimeId)?.name ?? runtimeId;
  const agentNamingModel = normalizeTaskNamingModelForProvider(
    runtimeId,
    namingAgent.model ?? providerConfig?.namingModel
  );
  const fallbackNamingModel = normalizeTaskNamingModelForProvider(
    runtimeId,
    taskSettings.namingModel
  );
  const model = normalizeTaskNamingModelForProvider(
    runtimeId,
    resolvePreferredTaskNamingModel({ agentNamingModel, fallbackNamingModel })
  );
  const settings: TaskNamingSettings = {
    model,
    language: taskSettings.namingLanguage,
    context: taskSettings.namingContext,
    recentTaskLimit: taskSettings.namingRecentTaskLimit,
    requestTimeoutMs: normalizeTaskNamingTimeoutMs(taskSettings.namingRequestTimeoutMs),
  };
  return {
    settings,
    defaultRuntime,
    runtimeId,
    runtimeName,
    providerConfig: providerConfig ?? null,
    runtime: providerConfig
      ? {
          runtimeId,
          runtimeName,
          providerConfig: { ...providerConfig, namingModel: settings.model },
        }
      : null,
    customSystemPrompt: namingAgent.systemPrompt,
  };
}

export async function buildCommonProjectNamingSources(input: {
  projectId: string;
  project?: ProjectProvider | null;
  projectName?: string;
  projectPath: string;
  settings: TaskNamingSettings;
  excludeTaskId?: string;
}): Promise<NamingContextSourceDraft[]> {
  const sources: NamingContextSourceDraft[] = [];

  if (input.settings.context.project) {
    const [projectRow] = await db
      .select({ name: projects.name, path: projects.path })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    sources.push({
      id: 'project',
      label: 'Project',
      content: [
        `Name: ${input.projectName ?? projectRow?.name ?? input.projectId}`,
        `Path: ${input.projectPath || projectRow?.path || input.project?.repoPath || ''}`,
      ].join('\n'),
    });
  }

  if (input.settings.context.readme && input.project) {
    const readme = await readProjectReadme(input.project);
    sources.push({ id: 'readme', label: readme?.path ?? 'README', content: readme?.content });
  }

  if (input.settings.context.recentTasks && input.settings.recentTaskLimit > 0) {
    const recent = await db
      .select({ name: tasks.name })
      .from(tasks)
      .where(
        input.excludeTaskId
          ? and(eq(tasks.projectId, input.projectId), ne(tasks.id, input.excludeTaskId))
          : eq(tasks.projectId, input.projectId)
      )
      .orderBy(desc(tasks.updatedAt))
      .limit(input.settings.recentTaskLimit);
    sources.push({
      id: 'recentTasks',
      label: 'Recent task titles',
      content: recent.map((task, index) => `${index + 1}. ${task.name}`).join('\n'),
    });
  }

  return sources;
}

export function createNamingContextSnapshot(input: {
  taskId: string;
  projectId: string;
  settings: TaskNamingSettings;
  sources: NamingContextSourceDraft[];
}): TaskNamingContextSnapshot {
  const sources: TaskNamingContextSource[] = [];
  let remaining = MAX_TOTAL_CONTEXT_CHARS;

  for (const source of input.sources) {
    if (!source.content?.trim() || remaining <= 0) continue;
    const clipped = clip(source.content.trim(), Math.min(MAX_SOURCE_CHARS, remaining));
    remaining -= clipped.content.length;
    sources.push({
      ...source,
      content: clipped.content,
      estimatedTokens: estimateTokens(clipped.content),
      truncated: clipped.truncated,
    });
  }

  return {
    version: 1,
    taskId: input.taskId,
    projectId: input.projectId,
    createdAt: new Date().toISOString(),
    language: input.settings.language,
    model: input.settings.model,
    estimatedTokens: sources.reduce((sum, source) => sum + source.estimatedTokens, 0),
    estimatedCharacters: sources.reduce((sum, source) => sum + source.content.length, 0),
    sourceCount: sources.length,
    sources,
  };
}

export function buildNamingPromptParts(input: {
  target: NamingTarget;
  context: TaskNamingContextSnapshot;
  includeBranchName?: boolean;
  customSystemPrompt?: string;
}): NamingPromptParts {
  const includeBranchName = Boolean(input.includeBranchName);
  const systemPrompt = buildNamingSystemPrompt({
    target: input.target,
    includeBranchName,
    language: input.context.language,
    customSystemPrompt: input.customSystemPrompt,
  });
  const prompt = [
    systemPrompt,
    '',
    'Use this JSON context:',
    JSON.stringify({
      target: input.target,
      includeBranchName: includeBranchName || undefined,
      language: input.context.language,
      sources: input.context.sources.map((source) => ({
        id: source.id,
        label: source.label,
        content: source.content,
      })),
    }),
  ].join('\n');
  return {
    systemPrompt,
    systemPromptEstimatedTokens: estimateTokens(systemPrompt),
    prompt,
    promptEstimatedTokens: estimateTokens(prompt),
  };
}

export async function generateTaskNames(
  input: GenerateTaskNamesInput
): Promise<GenerateTaskNamesResult> {
  const startedAt = Date.now();
  const stages: TaskNamingDebugStage[] = [];
  const recordStage = (
    name: string,
    durationMs: number,
    metadata?: TaskNamingDebugStage['metadata']
  ) => {
    stages.push({ name, durationMs, metadata });
  };
  console.log('[DEBUG][task-naming] generateTaskNames entry:', {
    taskId: input.taskId,
    projectId: input.projectId,
    includeBranchName: input.includeBranchName,
    strategyKind: input.params.strategy.kind,
    hasInitialPrompt: Boolean(input.params.initialConversation?.initialPrompt),
  });
  const namingRuntime = await resolveNamingRuntime(input.params.initialConversation?.runtime);
  const { settings, defaultRuntime, runtimeId, runtimeName, providerConfig, runtime } =
    namingRuntime;
  recordStage('settings', Date.now() - startedAt, {
    defaultRuntime,
    namingModelConfigured: Boolean(settings.model.trim()),
    recentTaskLimit: settings.recentTaskLimit,
    timeoutMs: settings.requestTimeoutMs,
  });
  console.log('[DEBUG][task-naming] settings loaded:', {
    taskId: input.taskId,
    projectId: input.projectId,
    durationMs: Date.now() - startedAt,
    defaultRuntime,
    namingModelConfigured: Boolean(settings.model.trim()),
    context: settings.context,
    recentTaskLimit: settings.recentTaskLimit,
    timeoutMs: settings.requestTimeoutMs,
  });
  recordStage('providerConfig', Date.now() - startedAt, {
    runtimeId,
    hasProviderConfig: Boolean(providerConfig),
    hasNamingCommand: Boolean(providerConfig?.namingCommand?.trim()),
  });
  console.log('[DEBUG][task-naming] provider resolved:', {
    taskId: input.taskId,
    projectId: input.projectId,
    durationMs: Date.now() - startedAt,
    runtimeId,
    runtimeName,
    hasProviderConfig: Boolean(providerConfig),
    hasNamingModel: Boolean(settings.model),
    hasNamingCommand: Boolean(providerConfig?.namingCommand?.trim()),
  });
  const contextStartedAt = Date.now();
  const context = await buildTaskNamingContextSnapshot(input, settings);
  recordStage('context', Date.now() - contextStartedAt, {
    sourceCount: context.sourceCount,
    estimatedTokens: context.estimatedTokens,
    estimatedCharacters: context.estimatedCharacters,
  });
  console.log('[DEBUG][task-naming] context built:', {
    taskId: input.taskId,
    projectId: input.projectId,
    durationMs: Date.now() - contextStartedAt,
    totalDurationMs: Date.now() - startedAt,
    sourceCount: context.sourceCount,
    estimatedTokens: context.estimatedTokens,
    estimatedCharacters: context.estimatedCharacters,
    sources: context.sources.map((source) => ({
      id: source.id,
      chars: source.content.length,
      tokens: source.estimatedTokens,
      truncated: Boolean(source.truncated),
    })),
  });
  const promptParts = buildNamingPromptParts({
    target: input.target ?? 'task',
    context,
    includeBranchName: input.includeBranchName,
    customSystemPrompt: namingRuntime.customSystemPrompt,
  });
  await saveNamingSnapshot({
    taskId: input.taskId,
    projectId: input.projectId,
    status: 'generating',
    model: settings.model,
    context,
    promptParts,
  });

  try {
    if (!runtime) {
      throw new Error(`No provider configuration is available for ${runtimeName}.`);
    }
    const requestStartedAt = Date.now();
    const result = await requestNamingPayload(
      context,
      input.includeBranchName,
      settings,
      runtime,
      input.project.repoPath,
      promptParts.prompt
    );
    recordStage('agentCliRequest', Date.now() - requestStartedAt, {
      method: result.method,
      model: result.model || null,
    });
    console.log('[DEBUG][task-naming] requestNamingPayload result:', {
      taskId: input.taskId,
      projectId: input.projectId,
      durationMs: Date.now() - requestStartedAt,
      totalDurationMs: Date.now() - startedAt,
      method: result.method,
      model: result.model,
      hasTaskName: typeof result.payload.taskName === 'string',
      hasBranchName: typeof result.payload.branchName === 'string',
    });
    const payload = result.payload;
    const taskName =
      (input.target ?? 'task') === 'session'
        ? normalizeGeneratedSessionTitle(payload.sessionTitle ?? payload.title ?? payload.taskName)
        : normalizeGeneratedTaskName(payload.taskName);
    const branchName = input.includeBranchName
      ? normalizeGeneratedBranchName(payload.branchName ?? taskName)
      : undefined;

    if (!taskName && !branchName) {
      throw new Error('Model did not return a usable task name or branch name.');
    }
    // For session-target naming the title is the primary deliverable; a missing
    // branch slug just skips the branch rename instead of failing the run.
    if (input.includeBranchName && !branchName && (input.target ?? 'task') === 'task') {
      throw new Error('Model did not return a usable branch name.');
    }

    const snapshot = await saveNamingSnapshot({
      taskId: input.taskId,
      projectId: input.projectId,
      status: 'ready',
      model: result.model || settings.model,
      context: {
        ...context,
        model: result.model || context.model,
        generationMethod: result.method,
        debugTrace: buildDebugTrace(startedAt, [...stages, ...result.stages]),
      },
      generatedTaskName: taskName,
      generatedBranchName: branchName,
      promptParts,
    });
    console.log('[DEBUG][task-naming] generateTaskNames success:', {
      taskId: input.taskId,
      projectId: input.projectId,
      totalDurationMs: Date.now() - startedAt,
      taskNameLength: taskName?.length ?? 0,
      branchNameLength: branchName?.length ?? 0,
    });
    return { success: true, taskName, branchName, snapshot };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn('task-naming-service: generate failed', {
      taskId: input.taskId,
      projectId: input.projectId,
      error: message,
    });
    const snapshot = await saveNamingSnapshot({
      taskId: input.taskId,
      projectId: input.projectId,
      status: 'failed',
      model: settings.model,
      context: {
        ...context,
        debugTrace: buildDebugTrace(startedAt, stages),
      },
      promptParts,
      error: message,
    });
    console.log('[DEBUG][task-naming] generateTaskNames failed:', {
      taskId: input.taskId,
      projectId: input.projectId,
      totalDurationMs: Date.now() - startedAt,
      error: message,
    });
    return { success: false, message, snapshot };
  }
}

export async function getTaskNamingSnapshot(taskId: string): Promise<TaskNamingSnapshot | null> {
  const [row] = await db
    .select()
    .from(taskNamingSnapshots)
    .where(eq(taskNamingSnapshots.taskId, taskId))
    .limit(1);
  return row ? mapNamingSnapshotRow(row) : null;
}

export async function getTaskNamingContextPreview(
  projectId: string,
  taskId: string
): Promise<TaskNamingContextSnapshot | null> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
    .limit(1);
  if (!row) return null;

  const project = projectManager.getProject(projectId);
  if (!project) return null;

  const params = parseSetupParams(row.setupData) ?? {
    id: taskId,
    projectId,
    name: row.name,
    sourceBranch: row.sourceBranch
      ? fromStoredBranch(row.sourceBranch)
      : { type: 'local' as const, branch: row.taskBranch ?? 'main' },
    strategy: row.taskBranch
      ? { kind: 'checkout-existing' as const }
      : { kind: 'no-worktree' as const },
  };
  const { settings } = await resolveNamingRuntime(params.initialConversation?.runtime);

  return buildTaskNamingContextSnapshot(
    {
      taskId,
      projectId,
      project,
      params: { ...params, id: taskId, projectId, name: params.name || row.name },
      includeBranchName: false,
    },
    settings
  );
}

async function buildTaskNamingContextSnapshot(
  input: GenerateTaskNamesInput,
  settings: TaskNamingSettings
): Promise<TaskNamingContextSnapshot> {
  const target = input.target ?? 'task';
  const sources: NamingContextSourceDraft[] = [];

  if (settings.context.prompt) {
    // Only the real first prompt belongs here. params.name may be a random
    // placeholder slug (blank submit), which must not masquerade as a prompt.
    sources.push({
      id: 'prompt',
      label: 'First user prompt',
      content: input.params.initialConversation?.initialPrompt,
    });
  }

  // Session naming is session-internal by design; only task naming aggregates
  // the task's sessions (titles + summaries) and the wider project sources.
  if (target === 'task') {
    sources.push(await buildTaskSessionsNamingSource(input.taskId));
    sources.push(
      ...(await buildCommonProjectNamingSources({
        projectId: input.projectId,
        project: input.project,
        projectPath: input.project.repoPath,
        settings,
        excludeTaskId: input.taskId,
      }))
    );
  }

  return createNamingContextSnapshot({
    taskId: input.taskId,
    projectId: input.projectId,
    settings,
    sources,
  });
}

const MAX_SESSION_SUMMARY_CHARS = 400;

/**
 * Aggregates this task's sessions (title + stored summary) — the primary
 * signal for task naming: the task name should reflect what its sessions did.
 * Uses stored summaries only (manual first, then the cached generated one);
 * naming must never trigger a summary generation of its own.
 */
async function buildTaskSessionsNamingSource(taskId: string): Promise<NamingContextSourceDraft> {
  const rows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      archivedAt: conversations.archivedAt,
    })
    .from(conversations)
    .where(eq(conversations.taskId, taskId))
    .orderBy(conversations.createdAt);
  const lines = await Promise.all(
    rows.map(async (row, index) => {
      const summary =
        (await getManualSummary(row.id, 'global'))?.text ??
        (await getStoredSummary(row.id, 'global'))?.summary.text;
      const flattened = summary?.replace(/\s+/g, ' ').trim();
      const summaryPart = flattened
        ? ` — ${clip(flattened, MAX_SESSION_SUMMARY_CHARS).content}`
        : '';
      const archivedPart = row.archivedAt ? ' (archived)' : '';
      return `${index + 1}. ${row.title}${archivedPart}${summaryPart}`;
    })
  );
  return {
    id: 'sessions',
    label: 'Sessions in this task (title — summary)',
    content: lines.join('\n'),
  };
}

async function readProjectReadme(
  project: ProjectProvider
): Promise<{ path: string; content: string } | null> {
  for (const candidate of README_CANDIDATES) {
    try {
      if (!(await project.fs.exists(candidate))) continue;
      const result = await project.fs.read(candidate, MAX_SOURCE_CHARS);
      return { path: candidate, content: result.content };
    } catch {}
  }
  return null;
}

async function requestNamingPayload(
  context: TaskNamingContextSnapshot,
  includeBranchName: boolean,
  settings: TaskNamingSettings,
  runtime: AgentNamingRuntime,
  cwd: string,
  prompt: string
): Promise<NamingPayloadResult> {
  return requestAgentNamingPayload({
    context,
    prompt,
    includeBranchName,
    settings,
    runtime,
    cwd,
  });
}

export async function requestAgentNamingPayload(input: {
  context: TaskNamingContextSnapshot;
  prompt: string;
  promptBuildDurationMs?: number;
  includeBranchName?: boolean;
  settings: Pick<TaskNamingSettings, 'requestTimeoutMs'>;
  runtime: AgentNamingRuntime;
  cwd: string;
}): Promise<NamingPayloadResult> {
  const startedAt = Date.now();
  const stages: TaskNamingDebugStage[] = [];
  const includeBranchName = Boolean(input.includeBranchName);
  stages.push({
    name: 'prompt',
    durationMs: input.promptBuildDurationMs ?? 0,
    metadata: {
      promptChars: input.prompt.length,
      promptEstimatedTokens: estimateTokens(input.prompt),
      includeBranchName,
    },
  });
  console.log('[DEBUG][agent-naming] prompt built:', {
    taskId: input.context.taskId,
    projectId: input.context.projectId,
    durationMs: Date.now() - startedAt,
    promptChars: input.prompt.length,
    promptEstimatedTokens: estimateTokens(input.prompt),
    includeBranchName,
  });
  const commandBuildStartedAt = Date.now();
  const command = withProviderStreamingMode(
    buildAgentNamingCommand(input.runtime.providerConfig, input.prompt),
    input.runtime.runtimeId
  );
  stages.push({
    name: 'commandBuild',
    durationMs: Date.now() - commandBuildStartedAt,
    metadata: {
      command: command.command,
      argCount: command.args.length,
      hasStdin: Boolean(command.stdin),
      stdinChars: command.stdin?.length ?? 0,
      timeoutMs: input.settings.requestTimeoutMs,
      jsonMode: isJsonModeCommand(command),
    },
  });
  console.log('[DEBUG][agent-naming] naming command built:', {
    taskId: input.context.taskId,
    projectId: input.context.projectId,
    durationMs: Date.now() - startedAt,
    command: command.command,
    argCount: command.args.length,
    hasStdin: Boolean(command.stdin),
    stdinChars: command.stdin?.length ?? 0,
    timeoutMs: input.settings.requestTimeoutMs,
    runtimeName: input.runtime.runtimeName,
  });
  const commandStartedAt = Date.now();
  const commandResult = await runAgentNamingCommand({
    ...command,
    cwd: input.cwd,
    env: {
      ...buildExternalToolEnv(
        resolveRuntimeBaseEnv(process.env, input.runtime.providerConfig, input.runtime.runtimeId)
      ),
      ...resolveRuntimeEnv(input.runtime.providerConfig, {
        runtimeId: input.runtime.runtimeId,
      }),
    },
    timeoutMs: input.settings.requestTimeoutMs,
    runtimeName: input.runtime.runtimeName,
  });
  stages.push({
    name: 'agentCli',
    durationMs: Date.now() - commandStartedAt,
    metadata: {
      rawChars: commandResult.stdout.length,
      stderrChars: commandResult.stderrChars,
      firstStdoutMs: commandResult.firstStdoutMs,
      firstStderrMs: commandResult.firstStderrMs,
      jsonEventCount: commandResult.jsonEventCount,
      firstJsonEventMs: commandResult.firstJsonEventMs,
      finalAgentMessageMs: commandResult.finalAgentMessageMs,
      command: command.command,
      argCount: command.args.length,
    },
  });
  console.log('[DEBUG][agent-naming] naming command raw output:', {
    taskId: input.context.taskId,
    projectId: input.context.projectId,
    durationMs: Date.now() - commandStartedAt,
    rawChars: commandResult.stdout.length,
    stderrChars: commandResult.stderrChars,
    firstStdoutMs: commandResult.firstStdoutMs,
    firstStderrMs: commandResult.firstStderrMs,
    jsonEventCount: commandResult.jsonEventCount,
    firstJsonEventMs: commandResult.firstJsonEventMs,
    finalAgentMessageMs: commandResult.finalAgentMessageMs,
  });
  const parseStartedAt = Date.now();
  const payload = parseNamingPayload(commandResult.stdout);
  stages.push({
    name: 'parseJson',
    durationMs: Date.now() - parseStartedAt,
    metadata: {
      hasTaskName: typeof payload.taskName === 'string',
      hasBranchName: typeof payload.branchName === 'string',
    },
  });
  console.log('[DEBUG][agent-naming] naming payload parsed:', {
    taskId: input.context.taskId,
    projectId: input.context.projectId,
    durationMs: Date.now() - parseStartedAt,
    totalDurationMs: Date.now() - startedAt,
    hasTaskName: typeof payload.taskName === 'string',
    hasBranchName: typeof payload.branchName === 'string',
  });
  return { payload, model: input.context.model, method: 'agent-cli', stages };
}

function buildNamingSystemPrompt(input: {
  target: NamingTarget;
  includeBranchName: boolean;
  language: string;
  customSystemPrompt?: string;
}): string {
  const builtInPrompt =
    input.target === 'session'
      ? buildSessionNamingSystemPrompt(input.language, input.includeBranchName)
      : buildTaskNamingSystemPrompt(input.includeBranchName, input.language);
  const trimmedCustomSystemPrompt = input.customSystemPrompt?.trim();
  return trimmedCustomSystemPrompt
    ? `${trimmedCustomSystemPrompt}\n\n${builtInPrompt}`
    : builtInPrompt;
}

function buildTaskNamingSystemPrompt(includeBranchName: boolean, language: string): string {
  const languageRule =
    language === 'zh-CN'
      ? 'Task name language: Simplified Chinese.'
      : language === 'en'
        ? 'Task name language: English.'
        : language === 'prompt'
          ? 'Task name language: follow the user prompt.'
          : 'Task name language: follow the application UI language when obvious; otherwise follow the user prompt.';
  return [
    'You generate concise names for coding tasks.',
    'Return strict JSON only. Do not include markdown, code fences, comments, or explanations.',
    languageRule,
    'taskName: human-readable, concise, action-oriented, abstract enough to hide incidental file paths.',
    `taskName max length: ${MAX_TASK_NAME_CHARS} characters.`,
    includeBranchName
      ? [
          'branchName: professional Git branch slug.',
          'branchName must be lowercase ASCII kebab-case using only a-z, 0-9, and hyphen.',
          `branchName max length: ${MAX_BRANCH_NAME_CHARS} characters.`,
          'Do not include git remote names, user names, issue IDs unless they are central to the task.',
        ].join('\n')
      : 'Omit branchName.',
    'JSON schema: {"taskName":"...","branchName":"..."}',
  ].join('\n');
}

function buildSessionNamingSystemPrompt(language: string, includeBranchName: boolean): string {
  const languageRule =
    language === 'zh-CN'
      ? 'Session title language: Simplified Chinese.'
      : language === 'en'
        ? 'Session title language: English.'
        : language === 'prompt'
          ? 'Session title language: follow the user prompt.'
          : 'Session title language: follow the application UI language when obvious; otherwise follow the user prompt.';
  return [
    'You generate concise names for individual coding-agent sessions.',
    'Return strict JSON only. Do not include markdown, code fences, comments, or explanations.',
    languageRule,
    'sessionTitle: human-readable, concise, and specific to this session only.',
    `sessionTitle max length: ${MAX_SESSION_TITLE_CHARS} characters.`,
    includeBranchName
      ? [
          'branchName: professional Git branch slug for the work this session does.',
          'branchName must be lowercase ASCII kebab-case using only a-z, 0-9, and hyphen.',
          `branchName max length: ${MAX_BRANCH_NAME_CHARS} characters.`,
        ].join('\n')
      : 'Do not generate a task name, branch name, project name, or generic status label.',
    includeBranchName
      ? 'JSON schema: {"sessionTitle":"...","branchName":"..."}'
      : 'JSON schema: {"sessionTitle":"..."}',
  ].join('\n');
}

/**
 * One-shot utility-agent call outside the task-naming flow: send a prompt
 * through the configured naming CLI and parse the JSON object it returns.
 * Reused by features that need a single structured answer (e.g. commit
 * message generation) without the naming snapshot/debug machinery.
 */
export async function requestUtilityAgentJson(input: {
  prompt: string;
  cwd: string;
}): Promise<Record<string, unknown>> {
  const resolved = await resolveNamingRuntime();
  if (!resolved.runtime) {
    throw new Error(`No naming command is configured for ${resolved.runtimeName}.`);
  }
  const command = withProviderStreamingMode(
    buildAgentNamingCommand(resolved.runtime.providerConfig, input.prompt),
    resolved.runtime.runtimeId
  );
  const result = await runAgentNamingCommand({
    ...command,
    cwd: input.cwd,
    env: {
      ...buildExternalToolEnv(
        resolveRuntimeBaseEnv(
          process.env,
          resolved.runtime.providerConfig,
          resolved.runtime.runtimeId
        )
      ),
      ...resolveRuntimeEnv(resolved.runtime.providerConfig, {
        runtimeId: resolved.runtime.runtimeId,
      }),
    },
    timeoutMs: resolved.settings.requestTimeoutMs,
    runtimeName: resolved.runtime.runtimeName,
  });
  return parseNamingPayload(result.stdout) as Record<string, unknown>;
}

function withProviderStreamingMode(
  command: ReturnType<typeof buildAgentNamingCommand>,
  runtimeId: RuntimeId
): ReturnType<typeof buildAgentNamingCommand> {
  if (runtimeId !== 'codex' || command.command !== 'codex' || command.args.includes('--json')) {
    return command;
  }
  return { ...command, args: [...command.args, '--json'] };
}

function isJsonModeCommand(command: ReturnType<typeof buildAgentNamingCommand>): boolean {
  return command.args.includes('--json');
}

function parseNamingPayload(raw: string | undefined): ModelNamingPayload {
  if (!raw) throw new Error('Model returned an empty response.');
  const codexJsonlPayload = extractCodexJsonlAgentMessage(raw);
  if (codexJsonlPayload) return parseNamingPayload(codexJsonlPayload);

  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  let parsed: ModelNamingPayload;
  try {
    parsed = JSON.parse(cleaned) as ModelNamingPayload;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('Model returned invalid JSON.');
    }
    parsed = JSON.parse(cleaned.slice(start, end + 1)) as ModelNamingPayload;
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Model returned invalid JSON.');
  return parsed;
}

function extractCodexJsonlAgentMessage(raw: string): string | null {
  let finalMessage: string | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!event || typeof event !== 'object') continue;
    const item = (event as { item?: unknown }).item;
    if (!item || typeof item !== 'object') continue;
    const typedItem = item as { type?: unknown; text?: unknown };
    if (typedItem.type === 'agent_message' && typeof typedItem.text === 'string') {
      finalMessage = typedItem.text;
    }
  }
  return finalMessage;
}

function normalizeGeneratedTaskName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const stripped = value.replace(/[\r\n]+/g, ' ').replace(/^["'“”‘’`]+|["'“”‘’`。.!?！？]+$/g, '');
  const normalized = normalizeTaskDisplayName(stripped);
  return normalized ? normalized.slice(0, MAX_TASK_NAME_CHARS) : undefined;
}

export function normalizeGeneratedSessionTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const stripped = value.replace(/[\r\n]+/g, ' ').replace(/^["'“”‘’`]+|["'“”‘’`。.!?！？]+$/g, '');
  const normalized = normalizeTaskDisplayName(stripped);
  return normalized ? normalized.slice(0, MAX_SESSION_TITLE_CHARS) : undefined;
}

function normalizeGeneratedBranchName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const slug = deriveTaskSlug(value).slice(0, MAX_BRANCH_NAME_CHARS);
  return slug || undefined;
}

export function buildDebugTrace(
  startedAt: number,
  stages: TaskNamingDebugStage[]
): TaskNamingDebugTrace {
  return {
    totalDurationMs: Date.now() - startedAt,
    stages,
  };
}

export function estimateTokens(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const cjkChars = trimmed.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
  const nonCjkChars = trimmed.length - cjkChars;
  return Math.max(1, Math.ceil(cjkChars + nonCjkChars / 4));
}

async function saveNamingSnapshot(input: {
  taskId: string;
  projectId: string;
  status: TaskNamingStatus;
  model: string | null;
  context: TaskNamingContextSnapshot | null;
  generatedTaskName?: string;
  generatedBranchName?: string;
  /** Assembled prompt parts to overlay on the live snapshot (not persisted). */
  promptParts?: NamingPromptParts;
  error?: string;
}): Promise<TaskNamingSnapshot> {
  const now = new Date().toISOString();
  const [existing] = await db
    .select({ createdAt: taskNamingSnapshots.createdAt })
    .from(taskNamingSnapshots)
    .where(eq(taskNamingSnapshots.taskId, input.taskId))
    .limit(1);
  const createdAt = input.status === 'generating' ? now : (existing?.createdAt ?? now);
  const [row] = await db
    .insert(taskNamingSnapshots)
    .values({
      taskId: input.taskId,
      projectId: input.projectId,
      status: input.status,
      model: input.model,
      contextJson: input.context ?? undefined,
      generatedTaskName: input.generatedTaskName ?? null,
      generatedBranchName: input.generatedBranchName ?? null,
      error: input.error ?? null,
      createdAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: taskNamingSnapshots.taskId,
      set: {
        projectId: input.projectId,
        status: input.status,
        model: input.model,
        contextJson: input.context ?? undefined,
        generatedTaskName: input.generatedTaskName ?? null,
        generatedBranchName: input.generatedBranchName ?? null,
        error: input.error ?? null,
        createdAt,
        updatedAt: now,
      },
    })
    .returning();
  const snapshot = withPromptParts(mapNamingSnapshotRow(row), input.promptParts);
  events.emit(taskNamingUpdatedChannel, snapshot);
  return snapshot;
}

/** Overlays the assembled (non-persisted) prompt parts onto a live snapshot. */
function withPromptParts(
  snapshot: TaskNamingSnapshot,
  parts?: NamingPromptParts
): TaskNamingSnapshot {
  if (!parts) return snapshot;
  return {
    ...snapshot,
    systemPrompt: parts.systemPrompt,
    systemPromptEstimatedTokens: parts.systemPromptEstimatedTokens,
    prompt: parts.prompt,
    promptChars: parts.prompt.length,
    promptEstimatedTokens: parts.promptEstimatedTokens,
  };
}

function mapNamingSnapshotRow(row: typeof taskNamingSnapshots.$inferSelect): TaskNamingSnapshot {
  return {
    taskId: row.taskId,
    projectId: row.projectId,
    status: row.status,
    model: row.model,
    context: row.contextJson ? normalizeContextSnapshot(row.contextJson) : null,
    generatedTaskName: row.generatedTaskName ?? undefined,
    generatedBranchName: row.generatedBranchName ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeContextSnapshot(context: TaskNamingContextSnapshot): TaskNamingContextSnapshot {
  const sources = context.sources.map((source) => ({
    ...source,
    estimatedTokens: source.estimatedTokens ?? estimateTokens(source.content),
  }));
  return {
    ...context,
    estimatedTokens:
      context.estimatedTokens ?? sources.reduce((sum, source) => sum + source.estimatedTokens, 0),
    estimatedCharacters:
      context.estimatedCharacters ??
      sources.reduce((sum, source) => sum + source.content.length, 0),
    sourceCount: context.sourceCount ?? sources.length,
    debugTrace: context.debugTrace,
    sources,
  };
}

function clip(input: string, max: number): { content: string; truncated: boolean } {
  if (input.length <= max) return { content: input, truncated: false };
  return { content: input.slice(0, max), truncated: true };
}

function parseSetupParams(value: string | null): CreateTaskParams | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { params?: CreateTaskParams };
    return parsed.params ?? null;
  } catch {
    return null;
  }
}

async function runAgentNamingCommand(input: {
  command: string;
  args: string[];
  stdin?: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  runtimeName: string;
}): Promise<AgentNamingCommandResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    console.log('[DEBUG][task-naming-cli] spawn:', {
      command: input.command,
      argCount: input.args.length,
      cwd: input.cwd,
      hasStdin: Boolean(input.stdin),
      stdinChars: input.stdin?.length ?? 0,
      timeoutMs: input.timeoutMs,
      runtimeName: input.runtimeName,
    });
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      shell: false,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let firstStdoutMs: number | null = null;
    let firstStderrMs: number | null = null;
    let stdoutLineBuffer = '';
    let jsonEventCount = 0;
    let firstJsonEventMs: number | null = null;
    let finalAgentMessageMs: number | null = null;
    let timedOut = false;
    let settled = false;
    const canResolveOnAgentMessage = input.command === 'codex' && input.args.includes('--json');
    const resolveCommand = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout,
        stderrChars: stderr.length,
        firstStdoutMs,
        firstStderrMs,
        jsonEventCount,
        firstJsonEventMs,
        finalAgentMessageMs,
      });
    };
    const rejectCommand = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      console.log('[DEBUG][task-naming-cli] timeout killing process:', {
        command: input.command,
        durationMs: Date.now() - startedAt,
        stdoutChars: stdout.length,
        stderrChars: stderr.length,
        firstStdoutMs,
        firstStderrMs,
        jsonEventCount,
        firstJsonEventMs,
        finalAgentMessageMs,
      });
      child.kill();
    }, input.timeoutMs);

    const append = (current: string, chunk: Buffer): string =>
      (current + chunk.toString('utf8')).slice(-MAX_COMMAND_OUTPUT_CHARS);

    child.stdout.on('data', (chunk: Buffer) => {
      firstStdoutMs ??= Date.now() - startedAt;
      const text = chunk.toString('utf8');
      stdout = (stdout + text).slice(-MAX_COMMAND_OUTPUT_CHARS);
      stdoutLineBuffer = inspectCodexJsonlChunk(stdoutLineBuffer + text, Date.now() - startedAt, {
        recordJsonEvent: () => {
          jsonEventCount += 1;
          firstJsonEventMs ??= Date.now() - startedAt;
        },
        recordFinalAgentMessage: () => {
          finalAgentMessageMs = Date.now() - startedAt;
          if (canResolveOnAgentMessage) {
            console.log('[DEBUG][task-naming-cli] resolving on codex agent_message:', {
              command: input.command,
              durationMs: finalAgentMessageMs,
              stdoutChars: stdout.length,
              jsonEventCount,
            });
            resolveCommand();
            child.kill();
          }
        },
      });
    });
    child.stderr.on('data', (chunk: Buffer) => {
      firstStderrMs ??= Date.now() - startedAt;
      stderr = append(stderr, chunk);
    });
    child.on('error', (error) => {
      console.log('[DEBUG][task-naming-cli] process error:', {
        command: input.command,
        durationMs: Date.now() - startedAt,
        error: error.message,
        stdoutChars: stdout.length,
        stderrChars: stderr.length,
        firstStdoutMs,
        firstStderrMs,
        jsonEventCount,
        firstJsonEventMs,
        finalAgentMessageMs,
      });
      rejectCommand(error);
    });
    child.on('close', (code) => {
      console.log('[DEBUG][task-naming-cli] close:', {
        command: input.command,
        code,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdoutChars: stdout.length,
        stderrChars: stderr.length,
        firstStdoutMs,
        firstStderrMs,
        jsonEventCount,
        firstJsonEventMs,
        finalAgentMessageMs,
      });
      if (settled) return;
      if (timedOut) {
        rejectCommand(new Error(`${input.runtimeName} naming command timed out.`));
        return;
      }
      if (code !== 0) {
        const detail = formatNamingCommandFailure(stdout, stderr, code);
        rejectCommand(new Error(`${input.runtimeName} naming command failed: ${detail}`));
        return;
      }
      resolveCommand();
    });

    child.stdin.end(input.stdin ?? '');
  });
}

function formatNamingCommandFailure(stdout: string, stderr: string, code: number | null): string {
  const combined = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n').trim();
  if (!combined) return `exit code ${code ?? 'unknown'}`;

  const explicitErrors = combined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        /^ERROR\b/i.test(line) ||
        /\binvalid_request_error\b/i.test(line) ||
        /"type":"error"/i.test(line)
    );
  const detail = explicitErrors.length > 0 ? explicitErrors.join('\n') : combined;
  return clipEnd(detail, MAX_COMMAND_ERROR_CHARS);
}

function inspectCodexJsonlChunk(
  buffer: string,
  elapsedMs: number,
  callbacks: {
    recordJsonEvent: () => void;
    recordFinalAgentMessage: () => void;
  }
): string {
  const lines = buffer.split(/\r?\n/);
  const tail = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    callbacks.recordJsonEvent();
    if (isCodexAgentMessageEvent(event)) {
      callbacks.recordFinalAgentMessage();
      console.log('[DEBUG][task-naming-cli] codex jsonl agent_message:', {
        durationMs: elapsedMs,
      });
    }
  }
  return tail;
}

function isCodexAgentMessageEvent(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false;
  const item = (event as { item?: unknown }).item;
  if (!item || typeof item !== 'object') return false;
  return (item as { type?: unknown }).type === 'agent_message';
}

function clipEnd(value: string, max: number): string {
  if (value.length <= max) return value;
  return `...${value.slice(value.length - max + 3)}`;
}
