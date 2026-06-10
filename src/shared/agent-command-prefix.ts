import { getRuntime, type RuntimeId } from './runtime-registry';

const KNOWN_COMMAND_PREFIXES = new Set(['/', '$']);
const COMMAND_NAME = /^[A-Za-z0-9][A-Za-z0-9_:.-]*$/;

/**
 * Keep agent-native command examples portable between providers.
 * Arbitrary prompts are left unchanged; only compact command-like values
 * such as "release", "/release", or "$release" are rewritten.
 */
export function applyAgentCommandPrefix(runtimeId: RuntimeId, text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';

  const commandPrefix = getRuntime(runtimeId)?.commandPrefix;
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

export function getAgentCommandSubmitSuffix(runtimeId: RuntimeId, text: string): string {
  const trimmed = text.trim();
  const provider = getRuntime(runtimeId);
  const commandPrefix = provider?.commandPrefix;
  const commandSubmitSuffix = provider?.commandSubmitSuffix;
  if (!trimmed || !commandPrefix || !commandSubmitSuffix) return '';
  if (!trimmed.startsWith(commandPrefix)) return '';

  const commandBody = trimmed.slice(commandPrefix.length);
  if (!commandBody || /\s/.test(commandBody)) return '';
  return commandSubmitSuffix;
}

export function getAgentCommandSubmitDelayMs(runtimeId: RuntimeId): number {
  return getRuntime(runtimeId)?.commandSubmitDelayMs ?? 0;
}

export function getAgentCommandSubmitInput(runtimeId: RuntimeId): string {
  return getRuntime(runtimeId)?.commandSubmitInput ?? '\r';
}

/**
 * Wrap multiline prompts in bracketed-paste markers so TUIs treat the
 * injection as a paste and preserve line breaks. Without the markers,
 * Claude Code sanitizes raw `\n` chunks into literal "\n" text.
 */
export function buildPromptInjectionPayload(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.includes('\n')) return trimmed;
  return `\x1b[200~${trimmed}\x1b[201~`;
}
