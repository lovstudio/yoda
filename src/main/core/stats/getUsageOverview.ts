import { basename } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { baseProjectSettingsSchema } from '@shared/project-settings';
import type { AgentAccountProviderId } from '@shared/runtime-registry';
import {
  addTokenBuckets,
  emptyTokenBuckets,
  type AuthProviderUsage,
  type DailyTokenUsage,
  type ModelUsage,
  type ProjectUsage,
  type RuntimeUsage,
  type TaskUsage,
  type TokenBuckets,
  type UsageOverview,
} from '@shared/stats';
import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import { db } from '@main/db/client';
import { conversations, projects, projectSettings, tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { resolveTaskCwd } from './task-cwd';
import { getTaskDiffTotals } from './task-diff-snapshot';
import { listClaudeSessionsForDirectory } from './transcript-readers/claude-session-files';
import { TRANSCRIPT_USAGE_PROVIDER_IDS } from './transcript-readers/registry';
import type { SessionTokenUsage } from './transcript-readers/types';
import { sessionUsageCache } from './usage-cache';

const TOP_TASKS_LIMIT = 10;
const PARSE_CONCURRENCY = 8;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]!);
      }
    })
  );
  return results;
}

/** Deduped `statsAuxiliaryPaths` across the targeted projects' settings. */
async function loadStatsAuxiliaryPaths(projectId?: string): Promise<string[]> {
  const settingsRows = projectId
    ? await db.select().from(projectSettings).where(eq(projectSettings.projectId, projectId))
    : await db.select().from(projectSettings);
  const paths = new Set<string>();
  for (const row of settingsRows) {
    try {
      const parsed = baseProjectSettingsSchema.safeParse(JSON.parse(row.baseProjectSettingsJson));
      if (!parsed.success) continue;
      for (const path of parsed.data.statsAuxiliaryPaths ?? []) {
        if (path) paths.add(path);
      }
    } catch {
      // Malformed settings JSON — skip, the settings page surfaces it.
    }
  }
  return [...paths];
}

/**
 * Lifetime usage rollup for the Usage view — one call returns totals, the
 * per-local-day series (heatmap), and runtime / auth-source / per-task
 * breakdowns. Token data comes from parsing every readable session
 * transcript (claude + codex); the first call pays the full parse, the mtime
 * cache makes subsequent calls cheap. Pass `projectId` to scope every number
 * to one project (used by the project overview).
 */
export async function getUsageOverview(projectId?: string): Promise<UsageOverview> {
  const allTasks = projectId
    ? await db.select().from(tasks).where(eq(tasks.projectId, projectId))
    : await db.select().from(tasks);
  const tasksArchived = allTasks.filter((task) => task.archivedAt !== null).length;

  const diffTotals = await Promise.all(allTasks.map((task) => getTaskDiffTotals(task)));
  let linesAdded = 0;
  let linesDeleted = 0;
  for (const { totals } of diffTotals) {
    linesAdded += totals.additions;
    linesDeleted += totals.deletions;
  }

  const rows = await db
    .select({ conversation: conversations, task: tasks, projectPath: projects.path })
    .from(conversations)
    .innerJoin(tasks, eq(conversations.taskId, tasks.id))
    .innerJoin(projects, eq(conversations.projectId, projects.id))
    .where(
      projectId
        ? and(
            inArray(conversations.runtime, TRANSCRIPT_USAGE_PROVIDER_IDS),
            eq(conversations.projectId, projectId)
          )
        : inArray(conversations.runtime, TRANSCRIPT_USAGE_PROVIDER_IDS)
    );

  // Many conversations share a task — resolve each task's cwd once.
  const cwdByTask = new Map<string, Promise<string>>();
  const startedAtMs = Date.now();
  const usages = await mapWithConcurrency(
    rows,
    PARSE_CONCURRENCY,
    ({ conversation, task, projectPath }) => {
      let cwd = cwdByTask.get(task.id);
      if (!cwd) {
        cwd = resolveTaskCwd(task, projectPath);
        cwdByTask.set(task.id, cwd);
      }
      return cwd.then((resolvedCwd) =>
        sessionUsageCache.getUsage(conversation.runtime, {
          cwd: resolvedCwd,
          conversationId: conversation.id,
          conversationTitle: conversation.title,
          conversationCreatedAt: conversation.createdAt,
        })
      );
    }
  );
  log.info('stats: usage overview transcripts parsed', {
    conversations: rows.length,
    parsed: usages.filter(Boolean).length,
    ms: Date.now() - startedAtMs,
  });

  // Sessions spawned before auth tracking landed have no recorded mode —
  // attribute them to the runtime's CURRENT configured mode (an estimate,
  // far more useful than an "untracked" bucket).
  const fallbackAuthByRuntime = new Map<string, AgentAccountProviderId>();
  for (const runtimeId of TRANSCRIPT_USAGE_PROVIDER_IDS) {
    const config = await runtimeOverrideSettings.getItem(runtimeId);
    fallbackAuthByRuntime.set(runtimeId, config?.authProvider ?? 'official-subscription');
  }

  let tokens: TokenBuckets | null = null;
  const dailyByDate = new Map<string, TokenBuckets>();
  const byProject = new Map<string, ProjectUsage>();
  const byModel = new Map<string | null, ModelUsage>();
  const byRuntime = new Map<string, RuntimeUsage>();
  const byAuthProvider = new Map<string, AuthProviderUsage>();
  const tokensByTask = new Map<string, TokenBuckets>();

  const projectRows = await db
    .select({ id: projects.id, name: projects.name, path: projects.path })
    .from(projects);
  const projectNameById = new Map(projectRows.map((row) => [row.id, row.name]));
  const projectByPath = new Map(projectRows.map((row) => [row.path, row]));
  const addProjectUsage = (
    usageProjectId: string,
    usage: SessionTokenUsage,
    source?: { name: string; external: boolean }
  ) => {
    const entry = byProject.get(usageProjectId);
    if (entry) {
      addTokenBuckets(entry.tokens, usage.total);
      entry.sessionCount += 1;
    } else {
      byProject.set(usageProjectId, {
        projectId: usageProjectId,
        name: source?.name ?? projectNameById.get(usageProjectId) ?? usageProjectId,
        ...(source?.external ? { external: true } : {}),
        tokens: { ...usage.total },
        sessionCount: 1,
      });
    }
  };

  const accumulate = (
    usage: SessionTokenUsage,
    runtimeId: string,
    authProvider: AgentAccountProviderId
  ) => {
    tokens = addTokenBuckets(tokens ?? emptyTokenBuckets(), usage.total);

    for (const day of usage.daily) {
      const bucket = dailyByDate.get(day.date);
      if (bucket) addTokenBuckets(bucket, day.tokens);
      else dailyByDate.set(day.date, { ...day.tokens });
    }

    for (const model of usage.byModel) {
      const modelUsage = byModel.get(model.model);
      if (modelUsage) {
        addTokenBuckets(modelUsage.tokens, model.tokens);
        modelUsage.sessionCount += 1;
      } else {
        byModel.set(model.model, {
          model: model.model,
          tokens: { ...model.tokens },
          sessionCount: 1,
        });
      }
    }

    const runtimeUsage = byRuntime.get(runtimeId);
    if (runtimeUsage) {
      addTokenBuckets(runtimeUsage.tokens, usage.total);
      runtimeUsage.sessionCount += 1;
    } else {
      byRuntime.set(runtimeId, {
        runtimeId,
        tokens: { ...usage.total },
        sessionCount: 1,
      });
    }

    const authUsage = byAuthProvider.get(authProvider);
    if (authUsage) addTokenBuckets(authUsage.tokens, usage.total);
    else byAuthProvider.set(authProvider, { authProvider, tokens: { ...usage.total } });
  };

  for (let index = 0; index < rows.length; index++) {
    const { conversation, task } = rows[index]!;
    const usage = usages[index];
    if (!usage) continue;

    const runtimeId = conversation.runtime ?? 'unknown';
    accumulate(
      usage,
      runtimeId,
      conversation.authProvider ?? fallbackAuthByRuntime.get(runtimeId) ?? 'official-subscription'
    );

    addProjectUsage(task.projectId, usage);

    const taskTokens = tokensByTask.get(task.id);
    if (taskTokens) addTokenBuckets(taskTokens, usage.total);
    else tokensByTask.set(task.id, { ...usage.total });
  }

  // Auxiliary directories: Claude sessions from other dirs (research dirs,
  // previous project locations) configured per project in settings. The
  // dedupe scope is deliberately asymmetric:
  // - Project scope: skip only THIS project's conversations. An aux dir that
  //   is itself another Yoda project still contributes here — pulling that
  //   work into this project's numbers is the point of the setting.
  // - Global scope: `rows` covers every tracked conversation, so sessions
  //   already attributed to their own project are skipped and the global
  //   total never double-counts.
  const auxPaths = await loadStatsAuxiliaryPaths(projectId);
  if (auxPaths.length > 0) {
    const trackedConversationIds = new Set(rows.map((row) => row.conversation.id));
    const auxSessions = (
      await Promise.all(
        auxPaths.map(async (path) => {
          // byProject attribution: the source directory's own project when it
          // is one, otherwise a synthetic per-directory row.
          const source = projectByPath.get(path);
          const sourceId = source?.id ?? `dir:${path}`;
          const sourceName = source?.name ?? basename(path);
          return (await listClaudeSessionsForDirectory(path)).map((session) => ({
            ...session,
            sourceId,
            sourceName,
            external: !source,
          }));
        })
      )
    )
      .flat()
      .filter((session) => !trackedConversationIds.has(session.sessionId));
    const auxUsages = await mapWithConcurrency(auxSessions, PARSE_CONCURRENCY, (session) =>
      sessionUsageCache.getUsageForPaths('claude', session.paths)
    );
    const claudeFallbackAuth = fallbackAuthByRuntime.get('claude') ?? 'official-subscription';
    for (let index = 0; index < auxSessions.length; index++) {
      const usage = auxUsages[index];
      if (!usage) continue;
      const session = auxSessions[index]!;
      accumulate(usage, 'claude', claudeFallbackAuth);
      addProjectUsage(session.sourceId, usage, {
        name: session.sourceName,
        external: session.external,
      });
    }
    log.info('stats: auxiliary path sessions parsed', {
      paths: auxPaths.length,
      sessions: auxSessions.length,
      parsed: auxUsages.filter(Boolean).length,
    });
  }

  const taskById = new Map(allTasks.map((task) => [task.id, task]));
  const topTasks: TaskUsage[] = [...tokensByTask.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, TOP_TASKS_LIMIT)
    .flatMap(([taskId, taskTokens]) => {
      const task = taskById.get(taskId);
      if (!task) return [];
      return [
        {
          taskId,
          projectId: task.projectId,
          name: task.name,
          archived: task.archivedAt !== null,
          tokens: taskTokens,
        },
      ];
    });

  const daily: DailyTokenUsage[] = [...dailyByDate.entries()]
    .map(([date, dayTokens]) => ({ date, tokens: dayTokens }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    tasksTotal: allTasks.length,
    tasksArchived,
    linesAdded,
    linesDeleted,
    tokens,
    daily,
    byProject: [...byProject.values()].sort((a, b) => b.tokens.total - a.tokens.total),
    byModel: [...byModel.values()].sort((a, b) => b.tokens.total - a.tokens.total),
    byRuntime: [...byRuntime.values()].sort((a, b) => b.tokens.total - a.tokens.total),
    byAuthProvider: [...byAuthProvider.values()].sort((a, b) => b.tokens.total - a.tokens.total),
    topTasks,
  };
}
