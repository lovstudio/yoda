import { and, eq } from 'drizzle-orm';
import type { Conversation, ConversationSessionInfo } from '@shared/conversations';
import type { RuntimeId } from '@shared/runtime-registry';
import {
  resolveClaudeTranscriptPath,
  resolveClaudeTranscriptPathFromConfigDir,
} from '@main/core/session-title/claude-title-source';
import {
  readCodexThreadArchiveStatus,
  readCodexThreadRolloutPath,
  resolveCodexStatePath,
} from '@main/core/session-title/codex-title-source';
import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import { db } from '@main/db/client';
import { conversations, projects } from '@main/db/schema';
import { resolveTask } from '../projects/utils';
import { getClaudeSessionActivity } from './claude-session-activity-source';
import { resolveAgentResumeSession } from './codex-session-id';
import { resolveLatestCodexThreadIdInLineage } from './codex-thread-lineage';
import { getReservedCodexThreadIds } from './codex-thread-reservations';
import { getConversationRuntimeStateRoot } from './conversation-session-source';
import { buildAgentCommand, buildAgentSubcommand } from './impl/agent-command';
import { withRuntimeStateRoot } from './session-state-roots';
import { mapConversationRowToConversation } from './utils';

export async function getConversationSessionInfo(
  projectId: string,
  taskId: string,
  conversationId: string,
  cwd?: string
): Promise<ConversationSessionInfo> {
  const [row] = await db
    .select({
      conversation: conversations,
      projectPath: projects.path,
      workspaceProvider: projects.workspaceProvider,
    })
    .from(conversations)
    .innerJoin(projects, eq(conversations.projectId, projects.id))
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.projectId, projectId),
        eq(conversations.taskId, taskId)
      )
    )
    .limit(1);

  if (!row) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  const conversation = mapConversationRowToConversation(row.conversation, true);
  const workingDirectory = cwd?.trim() || row.projectPath;
  const providerConfig = await runtimeOverrideSettings.getItem(conversation.runtimeId);
  const stateRoot = getConversationRuntimeStateRoot(conversation, providerConfig);
  const reservedThreadIds =
    conversation.runtimeId === 'codex'
      ? await getReservedCodexThreadIds(conversation.id)
      : undefined;
  const session = resolveAgentResumeSession(conversation, workingDirectory, {
    reservedThreadIds,
  });
  const activeSession = resolveTask(projectId, taskId)
    ?.conversations.getActiveSessions()
    .find((item) => item.conversationId === conversationId);
  const process =
    conversation.runtimeId === 'claude' && row.workspaceProvider !== 'ssh'
      ? await getClaudeSessionActivity({
          cwd: workingDirectory,
          conversationId: session.sessionId,
          processPid: activeSession?.pid,
          claudeHomeDir: stateRoot,
        }).then((activity) =>
          activity
            ? {
                pid: activity.pid ?? undefined,
                status: activity.status,
                updatedAt:
                  activity.updatedAt === null
                    ? undefined
                    : new Date(activity.updatedAt).toISOString(),
              }
            : undefined
        )
      : activeSession
        ? { pid: activeSession.pid }
        : undefined;
  const transcriptPath = resolveTranscriptPath({
    conversation,
    workingDirectory,
    stateRoot,
    sessionId: session.sessionId,
    reservedThreadIds,
  });

  return {
    sessionId: session.sessionId,
    sessionTitle: session.sessionTitle,
    transcriptPath,
    running: activeSession !== undefined,
    tmuxEnabled: activeSession?.detachable ?? false,
    process,
    resumeCommand: await buildResumeCommand({
      runtimeId: conversation.runtimeId,
      sessionId: session.sessionId,
      cwd: workingDirectory,
      stateRoot: conversation.sessionSource ? stateRoot : undefined,
      skillPolicy: conversation.skillPolicy,
      includeUnarchive:
        conversation.runtimeId === 'codex' &&
        readCodexThreadArchiveStatus(resolveCodexStatePath(stateRoot), session.sessionId) === true,
    }),
  };
}

function resolveTranscriptPath({
  conversation,
  workingDirectory,
  stateRoot,
  sessionId,
  reservedThreadIds,
}: {
  conversation: Conversation;
  workingDirectory: string;
  stateRoot: string | undefined;
  sessionId: string;
  reservedThreadIds?: ReadonlySet<string>;
}): string | undefined {
  if (conversation.runtimeId === 'claude') {
    return stateRoot
      ? resolveClaudeTranscriptPathFromConfigDir(workingDirectory, sessionId, stateRoot)
      : resolveClaudeTranscriptPath(workingDirectory, sessionId);
  }
  if (conversation.runtimeId !== 'codex') return undefined;
  const statePath = resolveCodexStatePath(stateRoot);
  const currentThreadId = resolveLatestCodexThreadIdInLineage({
    statePath,
    rootThreadId: sessionId,
    reservedThreadIds: reservedThreadIds ?? new Set<string>(),
  });
  return readCodexThreadRolloutPath(statePath, currentThreadId) ?? undefined;
}

async function buildResumeCommand({
  runtimeId,
  sessionId,
  cwd,
  stateRoot,
  includeUnarchive,
  skillPolicy,
}: {
  runtimeId: RuntimeId;
  sessionId: string;
  cwd?: string;
  stateRoot?: string;
  includeUnarchive?: boolean;
  skillPolicy?: Conversation['skillPolicy'];
}): Promise<string | undefined> {
  const configuredProvider = await runtimeOverrideSettings.getItem(runtimeId);
  const providerConfig =
    stateRoot && (runtimeId === 'claude' || runtimeId === 'codex')
      ? withRuntimeStateRoot(runtimeId, configuredProvider, stateRoot)
      : configuredProvider;
  if (!providerConfig?.cli) return undefined;
  if (!providerConfig.resumeFlag && !providerConfig.sessionIdFlag) return undefined;

  const { command, args } = buildAgentCommand({
    runtimeId,
    providerConfig,
    sessionId,
    isResuming: true,
    workingDirectory: cwd,
    skillPolicy,
  });
  const commands: string[] = [];
  if (includeUnarchive) {
    const unarchive = buildAgentSubcommand({
      runtimeId,
      providerConfig,
      subcommand: 'unarchive',
      subcommandArgs: [sessionId],
    });
    commands.push(shellCommand(unarchive.command, unarchive.args));
  }
  commands.push(shellCommand(command, args));
  const cmd = commands.join(' && ');
  return cwd ? `cd ${shellQuote(cwd)} && ${cmd}` : cmd;
}

function shellCommand(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(' ');
}

function shellQuote(value: string): string {
  if (value.length > 0 && /^[A-Za-z0-9_\-./:=@%+,]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
