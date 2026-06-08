import { spawn } from 'node:child_process';

const MAX_COMMAND_OUTPUT_CHARS = 32_000;
const MAX_COMMAND_ERROR_CHARS = 2_000;

export type AgentCliResult = {
  stdout: string;
  stderrChars: number;
};

/**
 * Spawns a provider CLI non-interactively, feeds it a prompt, and captures
 * stdout. This is the one generic "run the agent CLI and read its answer"
 * primitive — the app has no LLM API client, so every AI-generated feature
 * (task naming, session summary, …) goes through here.
 *
 * For Codex `--json` runs the process is killed as soon as the final
 * `agent_message` event arrives, instead of waiting for the CLI to exit.
 */
export function runAgentCli(input: {
  command: string;
  args: string[];
  stdin?: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  providerName: string;
}): Promise<AgentCliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      shell: false,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let stdoutLineBuffer = '';
    let timedOut = false;
    let settled = false;
    const canResolveOnAgentMessage = input.command === 'codex' && input.args.includes('--json');

    const finish = (run: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      run();
    };
    const succeed = () => finish(() => resolve({ stdout, stderrChars: stderr.length }));
    const fail = (error: Error) => finish(() => reject(error));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, input.timeoutMs);

    const append = (current: string, chunk: Buffer): string =>
      (current + chunk.toString('utf8')).slice(-MAX_COMMAND_OUTPUT_CHARS);

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stdout = (stdout + text).slice(-MAX_COMMAND_OUTPUT_CHARS);
      if (!canResolveOnAgentMessage) return;
      stdoutLineBuffer = inspectCodexJsonlChunk(stdoutLineBuffer + text, () => {
        succeed();
        child.kill();
      });
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.on('error', (error) => fail(error));
    child.on('close', (code) => {
      if (settled) return;
      if (timedOut) {
        fail(new Error(`${input.providerName} command timed out.`));
        return;
      }
      if (code !== 0) {
        fail(
          new Error(
            `${input.providerName} command failed: ${formatCommandFailure(stdout, stderr, code)}`
          )
        );
        return;
      }
      succeed();
    });

    child.stdin.end(input.stdin ?? '');
  });
}

/**
 * Extracts the final assistant message text from a CLI response. Handles
 * Codex JSONL (`agent_message` events) and plain stdout alike.
 */
export function extractAgentMessageText(raw: string): string {
  const codexMessage = extractCodexJsonlAgentMessage(raw);
  return (codexMessage ?? raw).trim();
}

function inspectCodexJsonlChunk(buffer: string, onFinalAgentMessage: () => void): string {
  const lines = buffer.split(/\r?\n/);
  const tail = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (isCodexAgentMessageEvent(event)) onFinalAgentMessage();
  }
  return tail;
}

function extractCodexJsonlAgentMessage(raw: string): string | null {
  let finalMessage: string | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!event || typeof event !== 'object') continue;
    const item = (event as { item?: unknown }).item;
    if (!item || typeof item !== 'object') continue;
    const typedItem = item as { type?: unknown; text?: unknown };
    if (typedItem.type === 'agent_message' && typeof typedItem.text === 'string') {
      finalMessage = typedItem.text;
    }
  }
  return finalMessage;
}

function isCodexAgentMessageEvent(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false;
  const item = (event as { item?: unknown }).item;
  if (!item || typeof item !== 'object') return false;
  return (item as { type?: unknown }).type === 'agent_message';
}

function formatCommandFailure(stdout: string, stderr: string, code: number | null): string {
  const combined = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n').trim();
  if (!combined) return `exit code ${code ?? 'unknown'}`;
  const explicitErrors = combined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        /^ERROR\b/i.test(line) ||
        /\binvalid_request_error\b/i.test(line) ||
        /"type":"error"/i.test(line)
    );
  const detail = explicitErrors.length > 0 ? explicitErrors.join('\n') : combined;
  return clipEnd(detail, MAX_COMMAND_ERROR_CHARS);
}

function clipEnd(value: string, max: number): string {
  if (value.length <= max) return value;
  return `...${value.slice(value.length - max + 3)}`;
}
