import type { CompiledQuickAction } from '@shared/quick-actions';

const MAX_LABEL_CHARS = 60;
const MAX_COMMAND_CHARS = 32_000;
const MAX_EXPLANATION_CHARS = 240;

export function buildQuickActionCompilationPrompt(
  intent: string,
  projectPath: string,
  executionSummary?: string
): string {
  const executionContext = executionSummary?.trim()
    ? `\nWHAT ACTUALLY HAPPENED IN THIS RUN:\n${executionSummary.trim()}\n`
    : '';
  return `You decide whether a completed project task is worth saving as a repeatable quick action. If it is, classify it as either a deterministic command or a reusable intelligent instruction.

You are running read-only inside this project:
${projectPath}

Inspect the repository before answering. Reuse its actual package manager, scripts, task runners, local documentation, and existing automation. Do not modify any files during this analysis.

USER OPERATION:
${intent}
${executionContext}

COMPILATION RULES:
- Choose "none" for one-off work, work already fully captured by an invoked Skill, or tasks without a useful repeatable operation. This keeps the UI quiet.
- Choose "command" when the operation can always be completed deterministically by one shell command or an inline automation script, without further intelligent judgment.
- Choose "skill" when every run still needs contextual reasoning, interpretation, content generation, review, or adaptive decisions.
- When an execution summary is present, prefer commands and instructions supported by what actually worked during this run.
- A command runs directly from the project root in the user's normal shell. Prefer existing scripts and checked-in automation over reimplementing their behavior.
- Make commands repeatable. Use an inline script, shell conditionals, or && when deterministic work needs multiple steps.
- A command must not invoke claude, codex, an AI agent, or another natural-language executor.
- Do not invent commands, scripts, ports, URLs, or package-manager conventions that are absent from the repository.
- A Skill keeps the user's reusable natural-language intent. Make it self-contained and action-oriented, but do not turn repository evidence or private analysis context into user-facing requirements.
- Do not add destructive behavior unless the user explicitly requested that behavior.
- The label should be concise and describe the action.
- Write the label and explanation in the same language as the user's operation.
- The explanation should briefly state why the operation is deterministic or still requires intelligence.

OUTPUT CONTRACT:
Return exactly one strict JSON object, with no Markdown fence or commentary.
No suggestion: {"kind":"none","explanation":"brief rationale"}
Command: {"kind":"command","label":"short action label","command":"one executable shell command","explanation":"brief rationale"}
Skill: {"kind":"skill","label":"short action label","instruction":"reusable natural-language instruction","explanation":"brief rationale"}`;
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
    kind?: unknown;
    label?: unknown;
    command?: unknown;
    instruction?: unknown;
    explanation?: unknown;
  };
  if (candidate.kind === 'none' && typeof candidate.explanation === 'string') {
    return {
      kind: 'none',
      explanation: candidate.explanation.trim().slice(0, MAX_EXPLANATION_CHARS),
    };
  }
  if (
    (candidate.kind !== 'command' && candidate.kind !== 'skill') ||
    typeof candidate.label !== 'string' ||
    !candidate.label.trim() ||
    typeof candidate.explanation !== 'string'
  ) {
    throw new Error('The quick action compiler returned an incomplete result.');
  }

  const common = {
    label: candidate.label.trim().slice(0, MAX_LABEL_CHARS),
    explanation: candidate.explanation.trim().slice(0, MAX_EXPLANATION_CHARS),
  };
  if (candidate.kind === 'skill') {
    if (typeof candidate.instruction !== 'string' || !candidate.instruction.trim()) {
      throw new Error('The quick action compiler returned an incomplete Skill.');
    }
    const instruction = candidate.instruction.trim();
    if (instruction.length > MAX_COMMAND_CHARS) {
      throw new Error('The generated Skill instruction is too long.');
    }
    return { kind: 'skill', ...common, instruction };
  }

  if (typeof candidate.command !== 'string' || !candidate.command.trim()) {
    throw new Error('The quick action compiler returned an incomplete command.');
  }
  const command = candidate.command.trim();
  if (command.length > MAX_COMMAND_CHARS) {
    throw new Error('The generated quick action command is too long.');
  }
  return { kind: 'command', ...common, command };
}
