import { getProvider, type AgentProviderId } from '@shared/agent-provider-registry';
import type { Conversation } from '@shared/conversations';
import type { ProvisionedTask } from '@renderer/features/tasks/stores/task';
import { rpc } from '@renderer/lib/ipc';
import { agentConfig } from '@renderer/utils/agentConfig';

export type TaskMenuSessionFields = {
  providerId?: AgentProviderId;
  sessionId?: string;
  sessionTitle?: string;
  providerName?: string;
  resumeCommand?: string;
  running?: boolean;
  tmuxEnabled?: boolean;
};

const SQLITE_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function conversationTime(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const normalized = SQLITE_TIMESTAMP_RE.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const ts = Date.parse(normalized);
  return Number.isNaN(ts) ? Number.NEGATIVE_INFINITY : ts;
}

function compareConversationPriority(a: Conversation, b: Conversation): number {
  const at = conversationTime(a.lastInteractedAt);
  const bt = conversationTime(b.lastInteractedAt);
  if (at !== bt) return bt - at;
  if (a.isInitialConversation !== b.isInitialConversation) {
    return a.isInitialConversation ? -1 : 1;
  }
  return a.id.localeCompare(b.id);
}

export function selectPreferredConversation(
  conversations: Iterable<Conversation>
): Conversation | undefined {
  let best: Conversation | undefined;
  for (const conversation of conversations) {
    if (!best || compareConversationPriority(conversation, best) < 0) {
      best = conversation;
    }
  }
  return best;
}

export function getTaskMenuConversation(
  provisionedTask: ProvisionedTask | null | undefined
): Conversation | undefined {
  if (!provisionedTask) return undefined;

  const activeConversationId = provisionedTask.taskView.tabManager.activeConversationId;
  const activeConversation = activeConversationId
    ? provisionedTask.conversations.conversations.get(activeConversationId)?.data
    : undefined;
  if (activeConversation) return activeConversation;

  return selectPreferredConversation(
    Array.from(provisionedTask.conversations.conversations.values(), (store) => store.data)
  );
}

export function buildTaskMenuSessionFields(
  conversation: Conversation,
  cwd?: string
): TaskMenuSessionFields {
  return {
    providerId: conversation.providerId,
    sessionId: conversation.id,
    sessionTitle: conversation.title,
    providerName: agentConfig[conversation.providerId].name,
    resumeCommand: buildResumeCommand({
      providerId: conversation.providerId,
      sessionId: conversation.id,
      cwd,
    }),
  };
}

export async function resolveTaskMenuSessionFields(
  conversation: Conversation,
  cwd?: string
): Promise<TaskMenuSessionFields> {
  const fallback = buildTaskMenuSessionFields(conversation, cwd);
  try {
    const resolved = await rpc.conversations.getConversationSessionInfo(
      conversation.projectId,
      conversation.taskId,
      conversation.id,
      cwd
    );
    return {
      ...fallback,
      sessionId: resolved.sessionId || fallback.sessionId,
      sessionTitle: resolved.sessionTitle ?? fallback.sessionTitle,
      resumeCommand: resolved.resumeCommand ?? fallback.resumeCommand,
      running: resolved.running,
      tmuxEnabled: resolved.tmuxEnabled,
    };
  } catch {
    return fallback;
  }
}

function shellQuote(value: string): string {
  if (value.length > 0 && /^[A-Za-z0-9_\-./:=@%+,]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildResumeCommand(input: {
  providerId: AgentProviderId;
  sessionId: string;
  cwd?: string;
}): string | undefined {
  const provider = getProvider(input.providerId);
  if (!provider?.cli) return undefined;
  const parts: string[] = [provider.cli];
  parts.push(...(provider.defaultArgs ?? []));
  if (provider.resumeFlag) {
    parts.push(...provider.resumeFlag.split(/\s+/).filter(Boolean));
    if (input.providerId === 'codex' && input.cwd?.trim()) {
      parts.push('--cd', input.cwd);
    }
    if (provider.sessionIdFlag || provider.resumeSessionIdArg) parts.push(input.sessionId);
  } else if (provider.sessionIdFlag) {
    parts.push(...provider.sessionIdFlag.split(/\s+/).filter(Boolean), input.sessionId);
  } else {
    return undefined;
  }
  const cmd = parts.map(shellQuote).join(' ');
  return input.cwd ? `cd ${shellQuote(input.cwd)} && ${cmd}` : cmd;
}
