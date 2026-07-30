import type { CompiledQuickAction } from '@shared/quick-actions';

const MAX_LABEL_CHARS = 60;
const MAX_COMMAND_CHARS = 32_000;
const MAX_EXPLANATION_CHARS = 240;

export function buildQuickActionCompilationPrompt(intent: string, projectPath: string): string {
  return `You compile a user's natural-language project operation into one deterministic, reusable shell command.

You are running read-only inside this project:
${projectPath}

Inspect the repository before answering. Reuse its actual package manager, scripts, task runners, local documentation, and existing automation. Do not modify any files during this analysis.

USER OPERATION:
${intent}

COMPILATION RULES:
- Return a programmatic shell command, not an Agent prompt and not natural-language instructions.
- The command will run directly from the project root in the user's normal shell.
- Prefer existing scripts and checked-in automation over reimplementing their behavior.
- Make the command repeatable. Use shell conditionals or && only when the requested operation needs multiple steps.
- Do not invoke claude, codex, an AI agent, or another natural-language executor.
- Do not invent commands, scripts, ports, URLs, or package-manager conventions that are absent from the repository.
- Do not add destructive behavior unless the user explicitly requested that behavior.
- The label should be concise and describe the action.
- The explanation should briefly state which repository evidence determined the command.

OUTPUT CONTRACT:
Return strict JSON only, with no Markdown fence or commentary:
{"label":"short action label","command":"one executable shell command","explanation":"brief repository-backed rationale"}`;
}

export function parseCompiledQuickAction(raw: string): CompiledQuickAction {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '');
  const objectStart = cleaned.indexOf('{');
  const objectEnd = cleaned.lastIndexOf('}');
  if (objectStart < 0 || objectEnd <= objectStart) {
    throw new Error('The quick action compiler returned an invalid response.');
  }

  let value: unknown;
  try {
    value = JSON.parse(cleaned.slice(objectStart, objectEnd + 1));
  } catch {
    throw new Error('The quick action compiler returned invalid JSON.');
  }
  if (!value || typeof value !== 'object') {
    throw new Error('The quick action compiler returned an incomplete command.');
  }

  const candidate = value as {
    label?: unknown;
    command?: unknown;
    explanation?: unknown;
  };
  if (
    typeof candidate.label !== 'string' ||
    !candidate.label.trim() ||
    typeof candidate.command !== 'string' ||
    !candidate.command.trim() ||
    typeof candidate.explanation !== 'string'
  ) {
    throw new Error('The quick action compiler returned an incomplete command.');
  }

  const command = candidate.command.trim();
  if (command.length > MAX_COMMAND_CHARS) {
    throw new Error('The generated quick action command is too long.');
  }
  return {
    label: candidate.label.trim().slice(0, MAX_LABEL_CHARS),
    command,
    explanation: candidate.explanation.trim().slice(0, MAX_EXPLANATION_CHARS),
  };
}
