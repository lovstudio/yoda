import {
  describeToolInput,
  flattenContentText,
  parseJsonLine,
  readNumber,
  readObject,
  readString,
  type StepCollector,
} from './step-builder';

/**
 * Turns a Claude Code transcript into invocation steps.
 *
 * Claude writes one row per content block, all repeating the same
 * `message.id` and the same cumulative `usage` — so usage is attached to the
 * first block of a message only, and the rest of the message's blocks carry no
 * tokens. Otherwise a single API response would look like it burned its cost
 * once per thought.
 *
 * `parentUuid` chains and compact boundaries are deliberately ignored here: a
 * trace is the flat sequence of what happened inside one invocation, and the
 * window already scopes it.
 */
export async function parseClaudeSteps(
  lines: AsyncIterable<string> | Iterable<string>,
  collector: StepCollector
): Promise<void> {
  // Tool names live on the call, results only carry the id — so the map is
  // built from every row, in or out of the window.
  const toolNames = new Map<string, string>();
  const usageSeen = new Set<string>();

  for await (const line of lines) {
    const row = parseJsonLine(line);
    if (!row) continue;
    const type = readString(row, 'type');
    const at = readString(row, 'timestamp');
    const sidechain = row.isSidechain === true;

    if (type === 'system') {
      if (readString(row, 'subtype') !== 'compact_boundary') continue;
      collector.push({ kind: 'compact', at, sidechain });
      continue;
    }

    const message = readObject(row, 'message');
    if (!message) continue;

    if (type === 'user') {
      pushUserSteps(collector, { at, sidechain, message, toolNames });
      continue;
    }
    if (type !== 'assistant') continue;

    const model = readString(message, 'model');
    const messageId = readString(message, 'id');
    const usage = messageId && !usageSeen.has(messageId) ? readObject(message, 'usage') : null;
    if (messageId) usageSeen.add(messageId);
    let tokens = usage
      ? {
          input: readNumber(usage, 'input_tokens'),
          cached:
            readNumber(usage, 'cache_read_input_tokens') +
            readNumber(usage, 'cache_creation_input_tokens'),
          output: readNumber(usage, 'output_tokens'),
        }
      : null;

    const content = message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const typed = block as Record<string, unknown>;
      const draft = describeAssistantBlock(typed, toolNames);
      if (!draft) continue;
      collector.push({ ...draft, at, model, sidechain, tokens });
      // Only the first block of the response carries the response's cost.
      tokens = null;
    }
  }
}

function describeAssistantBlock(
  block: Record<string, unknown>,
  toolNames: Map<string, string>
): {
  kind: 'thinking' | 'text' | 'tool-use';
  label?: string;
  detail: string | null;
  isError?: boolean;
} | null {
  switch (readString(block, 'type')) {
    case 'thinking':
      return { kind: 'thinking', detail: readString(block, 'thinking') };
    case 'text': {
      const text = readString(block, 'text');
      // The CLI surfaces upstream failures as ordinary assistant text.
      return { kind: 'text', detail: text, isError: /^API Error/i.test(text ?? '') };
    }
    case 'tool_use': {
      const name = readString(block, 'name');
      const id = readString(block, 'id');
      if (name && id) toolNames.set(id, name);
      return { kind: 'tool-use', label: name ?? undefined, detail: describeToolInput(block.input) };
    }
    default:
      return null;
  }
}

function pushUserSteps(
  collector: StepCollector,
  context: {
    at: string | null;
    sidechain: boolean;
    message: Record<string, unknown>;
    toolNames: Map<string, string>;
  }
): void {
  const { at, sidechain, message, toolNames } = context;
  const content = message.content;
  if (typeof content === 'string') {
    collector.push({ kind: 'prompt', at, detail: content, sidechain });
    return;
  }
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const typed = block as Record<string, unknown>;
    switch (readString(typed, 'type')) {
      case 'text':
        collector.push({ kind: 'prompt', at, detail: readString(typed, 'text'), sidechain });
        break;
      case 'tool_result': {
        const id = readString(typed, 'tool_use_id');
        collector.push({
          kind: 'tool-result',
          at,
          label: (id && toolNames.get(id)) ?? null,
          detail: flattenContentText(typed.content),
          isError: typed.is_error === true,
          sidechain,
        });
        break;
      }
      default:
        break;
    }
  }
}
