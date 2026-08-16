import type { AiLogStep, AiLogStepKind, AiLogStepTokens } from '@shared/ai-log-steps';

/** A step is a preview of its payload, not the payload. */
const MAX_DETAIL_CHARS = 1_500;
/** Hard cap on what one trace ships over IPC. */
const MAX_STEPS = 200;

export type StepWindow = { from: number; until: number };

export type StepDraft = {
  kind: AiLogStepKind;
  at: string | null;
  label?: string | null;
  model?: string | null;
  detail?: string | null;
  tokens?: AiLogStepTokens | null;
  isError?: boolean;
  sidechain?: boolean;
};

/**
 * Collects transcript rows that fall inside one invocation's time window.
 *
 * Rows without a usable timestamp are dropped rather than guessed into place —
 * a step in the wrong turn is worse than a missing one. `totalSteps` keeps
 * counting past the cap so the UI can say how much it is not showing.
 */
export class StepCollector {
  private readonly collected: AiLogStep[] = [];
  private total = 0;
  private previousAt: number | null = null;

  constructor(
    private readonly window: StepWindow,
    private readonly maxSteps: number = MAX_STEPS
  ) {}

  push(draft: StepDraft): void {
    const at = draft.at ? Date.parse(draft.at) : Number.NaN;
    if (!Number.isFinite(at)) return;
    if (at < this.window.from || at > this.window.until) return;
    this.total += 1;
    if (this.collected.length >= this.maxSteps) return;

    const { detail, clippedChars } = clipDetail(draft.detail ?? null);
    this.collected.push({
      index: this.collected.length,
      kind: draft.kind,
      at: draft.at,
      label: draft.label ?? null,
      model: draft.model ?? null,
      detail,
      clippedChars,
      tokens: draft.tokens ?? null,
      sinceMs: this.previousAt === null ? null : Math.max(0, at - this.previousAt),
      isError: draft.isError ?? false,
      sidechain: draft.sidechain ?? false,
    });
    this.previousAt = at;
  }

  /**
   * Attaches usage to the most recent step. Codex reports a request's tokens in
   * a separate event that lands after the content it paid for.
   */
  attachTokens(tokens: AiLogStepTokens): void {
    const last = this.collected.at(-1);
    if (!last) return;
    if (!last.tokens) {
      last.tokens = tokens;
      return;
    }
    last.tokens = {
      input: last.tokens.input + tokens.input,
      cached: last.tokens.cached + tokens.cached,
      output: last.tokens.output + tokens.output,
    };
  }

  steps(): AiLogStep[] {
    return this.collected;
  }

  totalSteps(): number {
    return this.total;
  }
}

function clipDetail(value: string | null): { detail: string | null; clippedChars: number } {
  if (!value) return { detail: null, clippedChars: 0 };
  const trimmed = value.trim();
  if (!trimmed) return { detail: null, clippedChars: 0 };
  if (trimmed.length <= MAX_DETAIL_CHARS) return { detail: trimmed, clippedChars: 0 };
  return {
    detail: trimmed.slice(0, MAX_DETAIL_CHARS),
    clippedChars: trimmed.length - MAX_DETAIL_CHARS,
  };
}

/**
 * The one field of a tool call that says what it did. Falls back to the raw
 * arguments — a tool we do not recognise still has to be debuggable.
 */
const SALIENT_INPUT_KEYS = [
  'command',
  'file_path',
  'pattern',
  'url',
  'query',
  'description',
  'prompt',
];

export function describeToolInput(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'string') return input;
  if (typeof input !== 'object') return String(input);
  const record = input as Record<string, unknown>;
  for (const key of SALIENT_INPUT_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  try {
    return JSON.stringify(record);
  } catch {
    return null;
  }
}

/** Tool results arrive as a string, or as blocks of text. */
export function flattenContentText(content: unknown): string | null {
  if (content === null || content === undefined) return null;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((block) => {
        if (typeof block === 'string') return block;
        if (!block || typeof block !== 'object') return null;
        const text = (block as { text?: unknown }).text;
        return typeof text === 'string' ? text : null;
      })
      .filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join('\n') : null;
  }
  if (typeof content === 'object') {
    const text = (content as { text?: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return null;
}

export function parseJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value ? value : null;
}

export function readNumber(source: Record<string, unknown> | null, key: string): number {
  if (!source) return 0;
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function readObject(
  source: Record<string, unknown> | null,
  key: string
): Record<string, unknown> | null {
  if (!source) return null;
  const value = source[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
