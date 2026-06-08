import { spawn } from 'node:child_process';
import { and, desc, eq, ne } from 'drizzle-orm';
import { getProvider, type AgentProviderId } from '@shared/agent-provider-registry';
import type { ProviderCustomConfig } from '@shared/app-settings';
import { taskNamingUpdatedChannel } from '@shared/events/taskEvents';
import { deriveTaskSlug, normalizeTaskDisplayName } from '@shared/task-name';
import {
  type TaskNamingContextSnapshot,
  type TaskNamingContextSource,
  type TaskNamingDebugStage,
  type TaskNamingDebugTrace,
  type TaskNamingSettings,
  type TaskNamingSnapshot,
  type TaskNamingStatus,
} from '@shared/task-naming';
import type { CreateTaskParams } from '@shared/tasks';
import { resolveProviderEnv } from '@main/core/conversations/impl/provider-env';
import { projectManager } from '@main/core/projects/project-manager';
import type { ProjectProvider } from '@main/core/projects/project-provider';
import { providerOverrideSettings } from '@main/core/settings/provider-settings-service';
import { appSettingsService } from '@main/core/settings/settings-service';
import { db } from '@main/db/client';
import { projects, taskNamingSnapshots, tasks } from '@main/db/schema';
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
};

type GenerateTaskNamesResult =
  | {
      success: true;
      taskName: string | undefined;
      branchName: string | undefined;
      snapshot: TaskNamingSnapshot;
    }
  | { success: false; message: string; snapshot: TaskNamingSnapshot };

type ModelNamingPayload = {
  taskName?: unknown;
  branchName?: unknown;
};

type NamingPayloadResult = {
  payload: ModelNamingPayload;
  model: string;
  method: 'agent-cli';
  stages: TaskNamingDebugStage[];
};

type AgentNamingRuntime = {
  providerId: AgentProviderId;
  providerName: string;
  providerConfig: ProviderCustomConfig;
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
  const [taskSettings, defaultAgent] = await Promise.all([
    appSettingsService.get('tasks'),
    appSettingsService.get('defaultAgent'),
  ]);
  recordStage('settings', Date.now() - startedAt, {
    defaultAgent,
    namingModelConfigured: Boolean(taskSettings.namingModel.trim()),
    recentTaskLimit: taskSettings.namingRecentTaskLimit,
    timeoutMs: taskSettings.namingRequestTimeoutMs,
  });
  console.log('[DEBUG][task-naming] settings loaded:', {
    taskId: input.taskId,
    projectId: input.projectId,
    durationMs: Date.now() - startedAt,
    defaultAgent,
    autoGenerateName: taskSettings.autoGenerateName,
    namingModelConfigured: Boolean(taskSettings.namingModel.trim()),
    context: taskSettings.namingContext,
    recentTaskLimit: taskSettings.namingRecentTaskLimit,
    timeoutMs: taskSettings.namingRequestTimeoutMs,
  });
  const providerId = input.params.initialConversation?.provider ?? defaultAgent;
  const providerConfig = await providerOverrideSettings.getItem(providerId);
  recordStage('providerConfig', Date.now() - startedAt, {
    providerId,
    hasProviderConfig: Boolean(providerConfig),
    hasNamingCommand: Boolean(providerConfig?.namingCommand?.trim()),
  });
  const agentNamingModel = normalizeTaskNamingModelForProvider(
    providerId,
    providerConfig?.namingModel
  );
  const fallbackNamingModel = normalizeTaskNamingModelForProvider(
    providerId,
    taskSettings.namingModel
  );
  const namingModel = normalizeTaskNamingModelForProvider(
    providerId,
    resolvePreferredTaskNamingModel({
      agentNamingModel,
      fallbackNamingModel,
    })
  );
  const settings: TaskNamingSettings = {
    model: namingModel,
    language: taskSettings.namingLanguage,
    context: taskSettings.namingContext,
    recentTaskLimit: taskSettings.namingRecentTaskLimit,
    requestTimeoutMs: taskSettings.namingRequestTimeoutMs,
  };
  const providerName = getProvider(providerId)?.name ?? providerId;
  console.log('[DEBUG][task-naming] provider resolved:', {
    taskId: input.taskId,
    projectId: input.projectId,
    durationMs: Date.now() - startedAt,
    providerId,
    providerName,
    hasProviderConfig: Boolean(providerConfig),
    hasNamingModel: Boolean(settings.model),
    hasNamingCommand: Boolean(providerConfig?.namingCommand?.trim()),
  });
  const runtime: AgentNamingRuntime | null = providerConfig
    ? {
        providerId,
        providerName,
        providerConfig: { ...providerConfig, namingModel: settings.model },
      }
    : null;
  const contextStartedAt = Date.now();
  const context = await buildContextSnapshot(input, settings);
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
  await saveNamingSnapshot({
    taskId: input.taskId,
    projectId: input.projectId,
    status: 'generating',
    model: settings.model,
    context,
  });

  try {
    if (!runtime) {
      throw new Error(`No provider configuration is available for ${providerName}.`);
    }
    const requestStartedAt = Date.now();
    const result = await requestNamingPayload(
      context,
      input.includeBranchName,
      settings,
      runtime,
      input.project.repoPath
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
    const taskName = normalizeGeneratedTaskName(payload.taskName);
    const branchName = input.includeBranchName
      ? normalizeGeneratedBranchName(payload.branchName ?? taskName)
      : undefined;

    if (!taskName && !branchName) {
      throw new Error('Model did not return a usable task name or branch name.');
    }
    if (input.includeBranchName && !branchName) {
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

  const taskSettings = await appSettingsService.get('tasks');
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

  return buildContextSnapshot(
    {
      taskId,
      projectId,
      project,
      params: { ...params, id: taskId, projectId, name: params.name || row.name },
      includeBranchName: false,
    },
    {
      model: taskSettings.namingModel.trim(),
      language: taskSettings.namingLanguage,
      context: taskSettings.namingContext,
      recentTaskLimit: taskSettings.namingRecentTaskLimit,
      requestTimeoutMs: taskSettings.namingRequestTimeoutMs,
    }
  );
}

async function buildContextSnapshot(
  input: GenerateTaskNamesInput,
  settings: TaskNamingSettings
): Promise<TaskNamingContextSnapshot> {
  const sources: TaskNamingContextSource[] = [];
  let remaining = MAX_TOTAL_CONTEXT_CHARS;

  const addSource = (
    source: Omit<TaskNamingContextSource, 'content' | 'estimatedTokens'> & { content?: string }
  ) => {
    if (!source.content?.trim() || remaining <= 0) return;
    const clipped = clip(source.content.trim(), Math.min(MAX_SOURCE_CHARS, remaining));
    remaining -= clipped.content.length;
    sources.push({
      ...source,
      content: clipped.content,
      estimatedTokens: estimateTokens(clipped.content),
      truncated: clipped.truncated,
    });
  };

  if (settings.context.prompt) {
    // Only the real first prompt belongs here. params.name may be a random
    // placeholder slug (blank submit), which must not masquerade as a prompt.
    addSource({
      id: 'prompt',
      label: 'First user prompt',
      content: input.params.initialConversation?.initialPrompt,
    });
  }

  if (settings.context.project) {
    const [projectRow] = await db
      .select({ name: projects.name, path: projects.path })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    addSource({
      id: 'project',
      label: 'Project',
      content: [
        `Name: ${projectRow?.name ?? input.projectId}`,
        `Path: ${projectRow?.path ?? input.project.repoPath}`,
      ].join('\n'),
    });
  }

  if (settings.context.readme) {
    const readme = await readProjectReadme(input.project);
    addSource({ id: 'readme', label: readme?.path ?? 'README', content: readme?.content });
  }

  if (settings.context.recentTasks && settings.recentTaskLimit > 0) {
    const recent = await db
      .select({ name: tasks.name })
      .from(tasks)
      .where(and(eq(tasks.projectId, input.projectId), ne(tasks.id, input.taskId)))
      .orderBy(desc(tasks.updatedAt))
      .limit(settings.recentTaskLimit);
    addSource({
      id: 'recentTasks',
      label: 'Recent task titles',
      content: recent.map((task, index) => `${index + 1}. ${task.name}`).join('\n'),
    });
  }

  return {
    version: 1,
    taskId: input.taskId,
    projectId: input.projectId,
    createdAt: new Date().toISOString(),
    language: settings.language,
    model: settings.model,
    estimatedTokens: sources.reduce((sum, source) => sum + source.estimatedTokens, 0),
    estimatedCharacters: sources.reduce((sum, source) => sum + source.content.length, 0),
    sourceCount: sources.length,
    sources,
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
  cwd: string
): Promise<NamingPayloadResult> {
  const startedAt = Date.now();
  const stages: TaskNamingDebugStage[] = [];
  const prompt = buildAgentNamingPrompt(context, includeBranchName);
  const promptDurationMs = Date.now() - startedAt;
  stages.push({
    name: 'prompt',
    durationMs: promptDurationMs,
    metadata: {
      promptChars: prompt.length,
      promptEstimatedTokens: estimateTokens(prompt),
      includeBranchName,
    },
  });
  console.log('[DEBUG][task-naming] prompt built:', {
    taskId: context.taskId,
    projectId: context.projectId,
    durationMs: Date.now() - startedAt,
    promptChars: prompt.length,
    promptEstimatedTokens: estimateTokens(prompt),
    includeBranchName,
  });
  const commandBuildStartedAt = Date.now();
  const command = withProviderStreamingMode(
    buildAgentNamingCommand(runtime.providerConfig, prompt),
    runtime.providerId
  );
  stages.push({
    name: 'commandBuild',
    durationMs: Date.now() - commandBuildStartedAt,
    metadata: {
      command: command.command,
      argCount: command.args.length,
      hasStdin: Boolean(command.stdin),
      stdinChars: command.stdin?.length ?? 0,
      timeoutMs: settings.requestTimeoutMs,
      jsonMode: isJsonModeCommand(command),
    },
  });
  console.log('[DEBUG][task-naming] naming command built:', {
    taskId: context.taskId,
    projectId: context.projectId,
    durationMs: Date.now() - startedAt,
    command: command.command,
    argCount: command.args.length,
    hasStdin: Boolean(command.stdin),
    stdinChars: command.stdin?.length ?? 0,
    timeoutMs: settings.requestTimeoutMs,
    providerName: runtime.providerName,
  });
  const commandStartedAt = Date.now();
  const commandResult = await runAgentNamingCommand({
    ...command,
    cwd,
    env: {
      ...buildExternalToolEnv(),
      ...resolveProviderEnv(runtime.providerConfig),
    },
    timeoutMs: settings.requestTimeoutMs,
    providerName: runtime.providerName,
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
  console.log('[DEBUG][task-naming] naming command raw output:', {
    taskId: context.taskId,
    projectId: context.projectId,
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
  console.log('[DEBUG][task-naming] naming payload parsed:', {
    taskId: context.taskId,
    projectId: context.projectId,
    durationMs: Date.now() - parseStartedAt,
    totalDurationMs: Date.now() - startedAt,
    hasTaskName: typeof payload.taskName === 'string',
    hasBranchName: typeof payload.branchName === 'string',
  });
  return { payload, model: settings.model, method: 'agent-cli', stages };
}

function buildSystemPrompt(includeBranchName: boolean, language: string): string {
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

function buildAgentNamingPrompt(
  context: TaskNamingContextSnapshot,
  includeBranchName: boolean
): string {
  return [
    buildSystemPrompt(includeBranchName, context.language),
    '',
    'Use this JSON context:',
    JSON.stringify({
      includeBranchName,
      language: context.language,
      sources: context.sources.map((source) => ({
        id: source.id,
        label: source.label,
        content: source.content,
      })),
    }),
  ].join('\n');
}

function withProviderStreamingMode(
  command: ReturnType<typeof buildAgentNamingCommand>,
  providerId: AgentProviderId
): ReturnType<typeof buildAgentNamingCommand> {
  if (providerId !== 'codex' || command.command !== 'codex' || command.args.includes('--json')) {
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

function normalizeGeneratedBranchName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const slug = deriveTaskSlug(value).slice(0, MAX_BRANCH_NAME_CHARS);
  return slug || undefined;
}

function buildDebugTrace(startedAt: number, stages: TaskNamingDebugStage[]): TaskNamingDebugTrace {
  return {
    totalDurationMs: Date.now() - startedAt,
    stages,
  };
}

function estimateTokens(value: string): number {
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
  const snapshot = mapNamingSnapshotRow(row);
  events.emit(taskNamingUpdatedChannel, snapshot);
  return snapshot;
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
  providerName: string;
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
      providerName: input.providerName,
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
        rejectCommand(new Error(`${input.providerName} naming command timed out.`));
        return;
      }
      if (code !== 0) {
        const detail = formatNamingCommandFailure(stdout, stderr, code);
        rejectCommand(new Error(`${input.providerName} naming command failed: ${detail}`));
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
