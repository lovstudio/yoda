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
 * Turns a Codex rollout into invocation steps.
 *
 * Codex records the same turn twice: `event_msg` entries are what the UI showed
 * (reasoning summaries, agent messages), `response_item` entries are the raw
 * request/response items. We take the events for model output and the response
 * items for tool traffic, so nothing is counted twice.
 *
 * `token_count` carries `info.last_token_usage` — already per-request — and
 * lands right after the content it paid for, so it attaches to the previous
 * step rather than becoming a step of its own.
 */
export async function parseCodexSteps(
  lines: AsyncIterable<string> | Iterable<string>,
  collector: StepCollector
): Promise<void> {
  const toolNames = new Map<string, string>();
  // The model can change between turns; `turn_context` announces each one.
  let model: string | null = null;

  for await (const line of lines) {
    const row = parseJsonLine(line);
    if (!row) continue;
    const at = readString(row, 'timestamp');
    const payload = readObject(row, 'payload');
    if (!payload) continue;
    const rowType = readString(row, 'type');

    if (rowType === 'turn_context') {
      model = readString(payload, 'model') ?? model;
      continue;
    }
    if (rowType === 'event_msg') {
      pushCodexEvent(collector, { at, model, payload });
      continue;
    }
    if (rowType === 'response_item') {
      pushCodexResponseItem(collector, { at, model, payload, toolNames });
    }
  }
}

function pushCodexEvent(
  collector: StepCollector,
  context: { at: string | null; model: string | null; payload: Record<string, unknown> }
): void {
  const { at, model, payload } = context;
  switch (readString(payload, 'type')) {
    case 'user_message':
      collector.push({ kind: 'prompt', at, detail: readString(payload, 'message') });
      break;
    case 'agent_reasoning':
      collector.push({ kind: 'thinking', at, model, detail: readString(payload, 'text') });
      break;
    case 'agent_message':
      collector.push({ kind: 'text', at, model, detail: readString(payload, 'message') });
      break;
    case 'token_count': {
      const usage = readObject(readObject(payload, 'info'), 'last_token_usage');
      if (!usage) break;
      collector.attachTokens({
        input: Math.max(
          0,
          readNumber(usage, 'input_tokens') - readNumber(usage, 'cached_input_tokens')
        ),
        cached: readNumber(usage, 'cached_input_tokens'),
        output: readNumber(usage, 'output_tokens'),
      });
      break;
    }
    default:
      break;
  }
}

const TOOL_CALL_TYPES = new Set(['custom_tool_call', 'function_call', 'local_shell_call']);
const TOOL_OUTPUT_TYPES = new Set(['custom_tool_call_output', 'function_call_output']);

function pushCodexResponseItem(
  collector: StepCollector,
  context: {
    at: string | null;
    model: string | null;
    payload: Record<string, unknown>;
    toolNames: Map<string, string>;
  }
): void {
  const { at, model, payload, toolNames } = context;
  const type = readString(payload, 'type');
  if (!type) return;
  const callId = readString(payload, 'call_id');

  if (TOOL_CALL_TYPES.has(type)) {
    const name = readString(payload, 'name');
    if (callId && name) toolNames.set(callId, name);
    collector.push({
      kind: 'tool-use',
      at,
      model,
      label: name,
      detail: describeToolInput(payload.input ?? payload.arguments ?? payload.action),
    });
    return;
  }
  if (TOOL_OUTPUT_TYPES.has(type)) {
    collector.push({
      kind: 'tool-result',
      at,
      label: (callId && toolNames.get(callId)) ?? null,
      detail: flattenContentText(payload.output),
    });
  }
}
