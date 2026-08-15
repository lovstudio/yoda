/**
 * Context-window sizes for Claude Code sessions, in tokens.
 *
 * Codex records its own window in every `token_count` event
 * (`info.model_context_window`); Claude Code records nothing, so the limit has
 * to come from a bundled table — Yoda has no API client to ask.
 *
 * Claude Code runs on the standard 200k window by default. Calibrated against
 * local transcripts: auto-compaction on `claude-opus-5` fires at 166k–173k
 * pre-tokens (200k minus the reserved output budget), while sessions with the
 * 1M context enabled reach 444k. So the window is inferred from what the
 * session actually used rather than assumed to be the model's maximum.
 */
export const CLAUDE_STANDARD_CONTEXT_WINDOW = 200_000;
const CLAUDE_EXTENDED_CONTEXT_WINDOW = 1_000_000;

/** Models offering the 1M context window. Prefix match against the model id. */
const EXTENDED_CONTEXT_MODEL_PREFIXES = [
  'claude-fable-5',
  'claude-mythos-5',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
];

/**
 * The window the session is running under, given the largest context it is
 * known to have held. Exceeding the standard window means the 1M context is on;
 * for a model with no known 1M option we report what was actually used rather
 * than fabricate headroom or render past 100%.
 */
export function resolveClaudeContextWindow(model: string | null, peakTokens: number): number {
  if (peakTokens <= CLAUDE_STANDARD_CONTEXT_WINDOW) return CLAUDE_STANDARD_CONTEXT_WINDOW;
  if (supportsExtendedContext(model)) return CLAUDE_EXTENDED_CONTEXT_WINDOW;
  return peakTokens;
}

function supportsExtendedContext(model: string | null): boolean {
  if (!model) return false;
  // Transcripts carry both `claude-opus-5` and `anthropic/claude-opus-5`.
  const normalized = model.trim().toLowerCase().replace(/^.*\//, '');
  return EXTENDED_CONTEXT_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}
