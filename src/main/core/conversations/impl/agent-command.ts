import type { RuntimeCustomConfig } from '@shared/app-settings';
import { findRuntimePermissionMode, getRuntime, type RuntimeId } from '@shared/runtime-registry';
import type { SkillSessionPolicy } from '@shared/skills/types';
import { buildClaudeSkillOverrides, buildCodexSkillConfig } from './skill-runtime-policy';

export type AgentCommand = {
  command: string;
  args: string[];
};

const SHELL_SYNTAX_ERROR = 'Custom CLI commands support executable command prefixes only. ';

const SHELL_BUILTINS = new Set(['.', 'source', 'eval', 'exec', 'cd', 'alias', 'export']);

type ParsedWords = { ok: true; words: string[] } | { ok: false; reason: string };

export function parseShellWords(
  input: string,
  options: { rejectShellSyntax?: boolean } = {}
): ParsedWords {
  const words: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      escaped = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (options.rejectShellSyntax && !inSingleQuote && !inDoubleQuote) {
      if (char === '$' || char === '`' || /[|&;<>]/.test(char)) {
        return { ok: false, reason: SHELL_SYNTAX_ERROR };
      }
    }

    if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        words.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escaped) current += '\\';
  if (inSingleQuote || inDoubleQuote) return { ok: false, reason: 'Unclosed quote.' };
  if (current.length > 0) words.push(current);

  return { ok: true, words };
}

function parseArgField(value: string | undefined): string[] {
  if (!value) return [];
  const parsed = parseShellWords(value);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.words;
}

type RuntimeModelArgOccurrence = {
  end: number;
  insertionIndex: number;
  model: string | undefined;
};

function matchRuntimeModelArg(
  args: readonly string[],
  start: number,
  flagTokens: readonly string[]
): Omit<RuntimeModelArgOccurrence, 'insertionIndex'> | undefined {
  if (flagTokens.length === 0) return undefined;

  const lastFlagIndex = flagTokens.length - 1;
  for (let offset = 0; offset < lastFlagIndex; offset += 1) {
    if (args[start + offset] !== flagTokens[offset]) return undefined;
  }

  const lastFlag = flagTokens[lastFlagIndex];
  const candidate = args[start + lastFlagIndex];
  if (candidate === undefined) return undefined;

  // Accept both `--model value` and `--model=value`. For multi-token flags,
  // the equals form is attached to the final token (for example,
  // `--config model=value`).
  if (candidate.startsWith(`${lastFlag}=`)) {
    return {
      end: start + flagTokens.length,
      model: candidate.slice(lastFlag.length + 1),
    };
  }
  if (candidate !== lastFlag) return undefined;

  const valueIndex = start + flagTokens.length;
  return {
    end: valueIndex < args.length ? valueIndex + 1 : valueIndex,
    model: args[valueIndex],
  };
}

/**
 * Collapses model arguments to one canonical runtime model flag.
 *
 * `preferredModel` wins over values already present in `args`; otherwise the
 * last existing value wins, matching normal CLI argument precedence. Callers
 * that resume an existing session should skip this helper so resume arguments
 * remain byte-for-byte unchanged.
 */
export function normalizeRuntimeModelArgs(
  args: readonly string[],
  modelFlag: string,
  preferredModel?: string | null,
  modelFlagAliases: readonly string[] = []
): string[] {
  const parsedFlagTokens = parseArgField(modelFlag);
  if (parsedFlagTokens.length === 0) return [...args];

  const flagTokens = [...parsedFlagTokens];
  const lastFlagIndex = flagTokens.length - 1;
  const usesEqualsForm = flagTokens[lastFlagIndex].endsWith('=');
  if (usesEqualsForm) flagTokens[lastFlagIndex] = flagTokens[lastFlagIndex].slice(0, -1);
  const matchers = [
    flagTokens,
    ...modelFlagAliases.map((alias) => {
      const tokens = parseArgField(alias);
      const lastIndex = tokens.length - 1;
      if (lastIndex >= 0 && tokens[lastIndex].endsWith('=')) {
        tokens[lastIndex] = tokens[lastIndex].slice(0, -1);
      }
      return tokens;
    }),
  ].filter((tokens) => tokens.length > 0);

  const cleanedArgs: string[] = [];
  const occurrences: RuntimeModelArgOccurrence[] = [];
  for (let index = 0; index < args.length; ) {
    let match: Omit<RuntimeModelArgOccurrence, 'insertionIndex'> | undefined;
    for (const matcher of matchers) {
      match = matchRuntimeModelArg(args, index, matcher);
      if (match) break;
    }
    if (!match) {
      cleanedArgs.push(args[index]);
      index += 1;
      continue;
    }

    occurrences.push({ ...match, insertionIndex: cleanedArgs.length });
    index = match.end;
  }

  const requestedModel = preferredModel?.trim();
  let selectedOccurrence: RuntimeModelArgOccurrence | undefined;
  if (requestedModel) {
    selectedOccurrence =
      occurrences.find((occurrence) => occurrence.model?.trim() === requestedModel) ??
      occurrences[0];
  } else {
    for (let index = occurrences.length - 1; index >= 0; index -= 1) {
      if (occurrences[index].model?.trim()) {
        selectedOccurrence = occurrences[index];
        break;
      }
    }
  }
  const selectedModel =
    requestedModel || selectedOccurrence?.model?.trim() || occurrences[0]?.model?.trim();
  if (!selectedModel) return cleanedArgs;

  const insertionIndex = selectedOccurrence?.insertionIndex ?? cleanedArgs.length;
  const normalizedModelArgs = usesEqualsForm
    ? [...flagTokens.slice(0, -1), `${flagTokens[lastFlagIndex]}=${selectedModel}`]
    : [...flagTokens, selectedModel];
  cleanedArgs.splice(insertionIndex, 0, ...normalizedModelArgs);
  return cleanedArgs;
}

function parseCliPrefix(value: string | undefined, runtimeId: RuntimeId): string[] {
  const cli = value?.trim();
  if (!cli) throw new Error(`Missing CLI command for provider: ${runtimeId}`);

  const parsed = parseShellWords(cli, { rejectShellSyntax: true });
  if (!parsed.ok) throw new Error(parsed.reason);
  const [command] = parsed.words;
  if (!command) throw new Error(`Missing CLI command for provider: ${runtimeId}`);
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(command)) throw new Error(SHELL_SYNTAX_ERROR);
  if (SHELL_BUILTINS.has(command)) throw new Error(SHELL_SYNTAX_ERROR);

  return parsed.words;
}

function formatTomlString(value: string): string {
  return JSON.stringify(value);
}

export function buildAgentCommand({
  runtimeId,
  providerConfig,
  autoApprove,
  permissionMode,
  initialPrompt,
  sessionId,
  isResuming,
  workingDirectory,
  appendSystemPrompt,
  model,
  terminalThemeMode,
  skillPolicy,
}: {
  runtimeId: RuntimeId;
  providerConfig: RuntimeCustomConfig | undefined;
  autoApprove?: boolean;
  /**
   * Selected permission-mode id. When set, its CLI args are applied and the
   * legacy `autoApprove` flag is ignored; the synthesized `bypass` tier falls
   * back to the runtime's autoApproveFlag.
   */
  permissionMode?: string;
  initialPrompt?: string;
  sessionId: string;
  isResuming?: boolean;
  workingDirectory?: string;
  /** Extra text appended after the runtime's system prompt when the runtime supports it. */
  appendSystemPrompt?: string;
  /** Agent/slot model; falls back to the runtime default for a new session. */
  model?: string | null;
  /**
   * Light/dark mode of Yoda's embedded terminal. When set, the Claude CLI is
   * told to match it so its menu/selection colors stay readable against the
   * terminal background. Omit for non-interactive or shareable commands.
   */
  terminalThemeMode?: 'light' | 'dark';
  /** Concrete skill paths captured with the conversation. */
  skillPolicy?: SkillSessionPolicy;
}): AgentCommand {
  const providerDef = getRuntime(runtimeId);
  const [command, ...args] = parseCliPrefix(providerConfig?.cli, runtimeId);

  args.push(...(providerConfig?.defaultArgs ?? []));

  const shouldPassSessionId =
    providerConfig?.sessionIdFlag && (!providerConfig.sessionIdOnResumeOnly || isResuming);
  const shouldAppendResumeSessionId = Boolean(
    providerConfig?.sessionIdFlag || providerConfig?.resumeSessionIdArg
  );

  if (isResuming && providerConfig?.resumeFlag) {
    args.push(...parseArgField(providerConfig.resumeFlag));
    if (runtimeId === 'codex' && workingDirectory?.trim()) {
      args.push('--cd', workingDirectory);
    }
    if (shouldAppendResumeSessionId) {
      args.push(sessionId);
    }
  } else if (shouldPassSessionId) {
    args.push(...parseArgField(providerConfig.sessionIdFlag), sessionId);
  } else if (!isResuming && providerDef?.newConversationFlag) {
    args.push(providerDef.newConversationFlag);
  }

  const permission = findRuntimePermissionMode(
    runtimeId,
    permissionMode,
    providerConfig?.autoApproveFlag
  );
  if (permission) {
    if (permission.usesAutoApproveFlag) {
      if (providerConfig?.autoApproveFlag)
        args.push(...parseArgField(providerConfig.autoApproveFlag));
    } else if (permission.args?.length) {
      args.push(...permission.args);
    }
  } else if (autoApprove && providerConfig?.autoApproveFlag) {
    args.push(...parseArgField(providerConfig.autoApproveFlag));
  }

  if (appendSystemPrompt && providerDef?.appendSystemPromptConfigKey) {
    args.push(
      '-c',
      `${providerDef.appendSystemPromptConfigKey}=${formatTomlString(appendSystemPrompt)}`
    );
  } else if (appendSystemPrompt && providerDef?.appendSystemPromptFlag) {
    args.push(providerDef.appendSystemPromptFlag, appendSystemPrompt);
  }

  const effectiveModel = model?.trim() || providerConfig?.defaultModel?.trim();

  // Model selection applies to a NEW session only — on resume the CLI session
  // already carries its model, and --model alongside --resume is often rejected.
  if (!isResuming && effectiveModel && providerDef?.modelFlag) {
    args.push(...parseArgField(providerDef.modelFlag), effectiveModel);
  }

  if (!isResuming && initialPrompt && !providerDef?.useKeystrokeInjection) {
    args.push(...parseArgField(providerConfig?.initialPromptFlag), initialPrompt);
  }

  const extraArgs = parseArgField(providerConfig?.extraArgs);

  if (skillPolicy && runtimeId === 'codex') {
    args.push('-c', `skills.config=${buildCodexSkillConfig(skillPolicy)}`);
  }

  // Claude ignores OSC 11 terminal-background detection once a theme is set in
  // its own config, so its dark-theme palette (e.g. pale blue 256-color 153)
  // washes out on Yoda's light terminal. Pass the terminal's mode explicitly so
  // the TUI's colors track the background. `--settings` merges over the user's
  // config (theme only); skip if the user already supplies their own --settings.
  const isClaudeCli = command === 'claude' || command.endsWith('/claude');
  const canInjectClaudeSettings =
    isClaudeCli && !args.includes('--settings') && !extraArgs.includes('--settings');
  if (canInjectClaudeSettings && (terminalThemeMode || skillPolicy)) {
    args.push(
      '--settings',
      JSON.stringify({
        ...(terminalThemeMode ? { theme: terminalThemeMode } : {}),
        ...(skillPolicy ? { skillOverrides: buildClaudeSkillOverrides(skillPolicy) } : {}),
      })
    );
  }

  args.push(...extraArgs);

  const normalizedArgs =
    !isResuming && providerDef?.modelFlag
      ? normalizeRuntimeModelArgs(
          args,
          providerDef.modelFlag,
          effectiveModel,
          providerDef.modelFlagAliases
        )
      : args;

  return { command, args: normalizedArgs };
}

export function buildAgentSubcommand({
  runtimeId,
  providerConfig,
  subcommand,
  subcommandArgs = [],
}: {
  runtimeId: RuntimeId;
  providerConfig: RuntimeCustomConfig | undefined;
  subcommand: string;
  subcommandArgs?: string[];
}): AgentCommand {
  const [command, ...args] = parseCliPrefix(providerConfig?.cli, runtimeId);
  args.push(...(providerConfig?.defaultArgs ?? []), subcommand, ...subcommandArgs);
  return { command, args };
}
