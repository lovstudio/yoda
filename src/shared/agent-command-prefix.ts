import { getProvider, type AgentProviderId } from './agent-provider-registry';

const KNOWN_COMMAND_PREFIXES = new Set(['/', '$']);
const COMMAND_NAME = /^[A-Za-z0-9][A-Za-z0-9_:-]*$/;

/**
 * Keep agent-native command examples portable between providers.
 * Arbitrary prompts are left unchanged; only compact command-like values
 * such as "release", "/release", or "$release" are rewritten.
 */
export function applyAgentCommandPrefix(providerId: AgentProviderId, text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';

  const commandPrefix = getProvider(providerId)?.commandPrefix;
  if (!commandPrefix) return trimmed;

  const first = trimmed[0];
  const second = trimmed[1];
  if (first && KNOWN_COMMAND_PREFIXES.has(first)) {
    if (!second || /\s/.test(second)) return trimmed;
    return first === commandPrefix ? trimmed : `${commandPrefix}${trimmed.slice(1)}`;
  }

  if (!COMMAND_NAME.test(trimmed)) {
    return trimmed;
  }

  return `${commandPrefix}${trimmed}`;
}

export function getAgentCommandSubmitSuffix(providerId: AgentProviderId, text: string): string {
  const trimmed = text.trim();
  const provider = getProvider(providerId);
  const commandPrefix = provider?.commandPrefix;
  const commandSubmitSuffix = provider?.commandSubmitSuffix;
  if (!trimmed || !commandPrefix || !commandSubmitSuffix) return '';
  if (!trimmed.startsWith(commandPrefix)) return '';

  const commandBody = trimmed.slice(commandPrefix.length);
  if (!commandBody || /\s/.test(commandBody)) return '';
  return commandSubmitSuffix;
}

export function getAgentCommandSubmitDelayMs(providerId: AgentProviderId): number {
  return getProvider(providerId)?.commandSubmitDelayMs ?? 0;
}

export function getAgentCommandSubmitInput(providerId: AgentProviderId): string {
  return getProvider(providerId)?.commandSubmitInput ?? '\r';
}

export function buildPromptInjectionPayload(args: {
  providerId: AgentProviderId | string | undefined;
  text: string;
}): string {
  const trimmed = args.text.trim();
  const hasMultilinePayload = trimmed.includes('\n');
  const shouldUseBracketedPaste = args.providerId !== 'claude' && hasMultilinePayload;
  if (!shouldUseBracketedPaste) return trimmed;
  return `\x1b[200~${trimmed}\x1b[201~`;
}
