import { parseClaudeSteps } from './claude-step-reader';
import { parseCodexSteps } from './codex-step-reader';
import type { StepCollector } from './step-builder';

export type TranscriptStepParser = (
  lines: AsyncIterable<string> | Iterable<string>,
  collector: StepCollector
) => Promise<void>;

const parsers = new Map<string, TranscriptStepParser>([
  ['claude', parseClaudeSteps],
  ['codex', parseCodexSteps],
]);

/** Null for providers whose transcript format we cannot read. */
export function getTranscriptStepParser(runtimeId: string | null): TranscriptStepParser | null {
  if (!runtimeId) return null;
  return parsers.get(runtimeId) ?? null;
}
