import type { RuntimeCustomConfig } from '@shared/app-settings';
import { getRuntime, type RuntimeId } from '@shared/runtime-registry';

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
  initialPrompt,
  sessionId,
  isResuming,
  workingDirectory,
  appendSystemPrompt,
  model,
  terminalThemeMode,
}: {
  runtimeId: RuntimeId;
  providerConfig: RuntimeCustomConfig | undefined;
  autoApprove?: boolean;
  initialPrompt?: string;
  sessionId: string;
  isResuming?: boolean;
  workingDirectory?: string;
  /** Extra text appended after the runtime's system prompt when the runtime supports it. */
  appendSystemPrompt?: string;
  /** Agent's configured model; passed via the runtime's modelFlag on a new session. */
  model?: string | null;
  /**
   * Light/dark mode of Yoda's embedded terminal. When set, the Claude CLI is
   * told to match it so its menu/selection colors stay readable against the
   * terminal background. Omit for non-interactive or shareable commands.
   */
  terminalThemeMode?: 'light' | 'dark';
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

  if (autoApprove && providerConfig?.autoApproveFlag) {
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

  // Model selection applies to a NEW session only — on resume the CLI session
  // already carries its model, and --model alongside --resume is often rejected.
  if (!isResuming && model?.trim() && providerDef?.modelFlag) {
    args.push(...parseArgField(providerDef.modelFlag), model.trim());
  }

  if (!isResuming && initialPrompt && !providerDef?.useKeystrokeInjection) {
    args.push(...parseArgField(providerConfig?.initialPromptFlag), initialPrompt);
  }

  const extraArgs = parseArgField(providerConfig?.extraArgs);

  // Claude ignores OSC 11 terminal-background detection once a theme is set in
  // its own config, so its dark-theme palette (e.g. pale blue 256-color 153)
  // washes out on Yoda's light terminal. Pass the terminal's mode explicitly so
  // the TUI's colors track the background. `--settings` merges over the user's
  // config (theme only); skip if the user already supplies their own --settings.
  const isClaudeCli = command === 'claude' || command.endsWith('/claude');
  if (
    isClaudeCli &&
    terminalThemeMode &&
    !args.includes('--settings') &&
    !extraArgs.includes('--settings')
  ) {
    args.push('--settings', JSON.stringify({ theme: terminalThemeMode }));
  }

  args.push(...extraArgs);

  return { command, args };
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
