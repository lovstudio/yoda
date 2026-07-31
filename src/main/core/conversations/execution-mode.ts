import type { ConversationExecutionMode } from '@shared/conversations';

export const AUTOMATION_SESSION_INSTRUCTIONS = [
  'Yoda automation execution contract:',
  '- This conversation is one unattended automation run. Complete the requested work in this run, report the outcome once, and then stop.',
  '- Do not create, resume, update, pause, or wait on a Goal. Do not ask the user whether to continue a Goal.',
  '- If an external dependency is not ready, report the current result and end this run. A later schedule is a separate run.',
  '- Request user input only when the requested action truly requires a choice that cannot be inferred from the task context.',
].join('\n');

export function withExecutionModeInstructions(
  baseInstructions: string | undefined,
  executionMode: ConversationExecutionMode | undefined
): string | undefined {
  if (executionMode !== 'automation') return baseInstructions;
  return [baseInstructions?.trim(), AUTOMATION_SESSION_INSTRUCTIONS].filter(Boolean).join('\n\n');
}
