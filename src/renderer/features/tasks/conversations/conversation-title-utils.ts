import { type AgentProviderId } from '@shared/agent-provider-registry';
import { taskNameFromPrompt } from '@shared/task-name';
import { agentConfig } from '@renderer/utils/agentConfig';

type ConversationTitleInput = {
  providerId: AgentProviderId;
  title: string;
};

function capitalizeProviderId(providerId: AgentProviderId): string {
  return `${providerId.charAt(0).toUpperCase()}${providerId.slice(1)}`;
}

function agentDisplayName(providerId: AgentProviderId): string {
  return agentConfig[providerId]?.name ?? capitalizeProviderId(providerId);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseDefaultTitleIndex(title: string, providerId: AgentProviderId): number | null {
  const candidates = [agentDisplayName(providerId), capitalizeProviderId(providerId), providerId];
  for (const candidate of candidates) {
    const escaped = escapeRegExp(candidate);
    const bareMatch = title.match(new RegExp(`^${escaped}$`, 'i'));
    if (bareMatch) return 1;
    const indexedMatch = title.match(new RegExp(`^${escaped} \\(([1-9]\\d*)\\)$`, 'i'));
    if (!indexedMatch) continue;
    const rawIndex = indexedMatch[1];
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 1) continue;
    if (String(index) !== rawIndex) continue;
    return index;
  }
  return null;
}

export function formatConversationTitleForDisplay(
  providerId: AgentProviderId,
  title: string
): string {
  const index = parseDefaultTitleIndex(title, providerId);
  if (index === null) return title;
  const name = agentDisplayName(providerId);
  return index === 1 ? name : `${name} (${index})`;
}

export function nextDefaultConversationTitle(
  providerId: AgentProviderId,
  conversations: ConversationTitleInput[]
): string {
  const used = new Set<number>();

  for (const conversation of conversations) {
    if (conversation.providerId !== providerId) continue;
    const index = parseDefaultTitleIndex(conversation.title, providerId);
    if (index !== null) used.add(index);
  }

  let next = 1;
  while (used.has(next)) next += 1;

  const name = agentDisplayName(providerId);
  return next === 1 ? name : `${name} (${next})`;
}

export function initialConversationTitle(
  providerId: AgentProviderId,
  initialPrompt: string | undefined,
  conversations: ConversationTitleInput[]
): string {
  const promptTitle = initialPrompt ? taskNameFromPrompt(initialPrompt) : '';
  return promptTitle || nextDefaultConversationTitle(providerId, conversations);
}
