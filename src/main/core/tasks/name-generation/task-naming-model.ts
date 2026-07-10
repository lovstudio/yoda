import type { RuntimeCustomConfig } from '@shared/app-settings';
import type { RuntimeId } from '@shared/runtime-registry';
import { parseShellWords } from '@main/core/conversations/impl/agent-command';

const MODEL_FLAGS = new Set(['--model', '-m']);
const MODEL_KEY_PATTERN = /^(?:model|model-id|model_id)$/i;
const CODEX_EXEC_UNSUPPORTED_MODEL_ALIASES = new Set(['chat-latest']);

export function resolveCurrentAgentModel(providerConfig: RuntimeCustomConfig | undefined): string {
  const args = collectLaunchArgs(providerConfig);
  for (let index = args.length - 1; index >= 0; index -= 1) {
    const arg = args[index]?.trim();
    if (!arg) continue;

    const inlineFlag = arg.match(/^(--model|-m)=(.+)$/);
    if (inlineFlag?.[2]?.trim()) return inlineFlag[2].trim();

    const keyValue = arg.match(/^([A-Za-z][A-Za-z0-9_-]*)=(.+)$/);
    if (keyValue?.[1] && keyValue[2]?.trim() && MODEL_KEY_PATTERN.test(keyValue[1])) {
      return keyValue[2].trim();
    }

    if (MODEL_FLAGS.has(arg)) {
      const value = args[index + 1]?.trim();
      if (value && !value.startsWith('-')) return value;
    }
  }

  return providerConfig?.defaultModel?.trim() ?? '';
}

export function resolvePreferredTaskNamingModel({
  agentNamingModel,
  currentAgentModel,
  fallbackNamingModel,
  inferredNamingModel,
}: {
  agentNamingModel?: string;
  currentAgentModel?: string;
  fallbackNamingModel?: string;
  inferredNamingModel?: string;
}): string {
  return (
    agentNamingModel?.trim() ||
    currentAgentModel?.trim() ||
    fallbackNamingModel?.trim() ||
    inferredNamingModel?.trim() ||
    ''
  );
}

export function normalizeTaskNamingModelForProvider(
  runtimeId: RuntimeId,
  model: string | undefined
): string {
  const trimmed = model?.trim() ?? '';
  if (!trimmed) return '';
  if (runtimeId === 'codex' && CODEX_EXEC_UNSUPPORTED_MODEL_ALIASES.has(trimmed.toLowerCase())) {
    return '';
  }
  return trimmed;
}

function collectLaunchArgs(providerConfig: RuntimeCustomConfig | undefined): string[] {
  const args: string[] = [];
  const cliWords = parseWords(providerConfig?.cli);
  if (cliWords.length > 1) args.push(...cliWords.slice(1));
  args.push(...(providerConfig?.defaultArgs ?? []));
  args.push(...parseWords(providerConfig?.extraArgs));
  return args;
}

function parseWords(value: string | undefined): string[] {
  const input = value?.trim();
  if (!input) return [];
  const parsed = parseShellWords(input);
  return parsed.ok ? parsed.words : [];
}
