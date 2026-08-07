import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

type AgentCommand = { command: string; args: string[] };
type AdapterOptions = {
  cohubCommand: AgentCommand;
  cwd: string;
  initialPrompt?: string;
  stateFile: string;
};
type AdapterState = { sessionId?: string; spaceId?: string };
type CohubPromptResult = {
  session?: { id?: string };
  turn?: { id?: string };
};
type CohubTurn = {
  assistantText?: string | null;
  errorMessage?: string | null;
  id?: string;
  status?: string;
};

const activeChildren = new Set<ChildProcess>();
let shuttingDown = false;

export function extractFirstJsonObject(text: string): string | undefined {
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let escaped = false;
  let inString = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return text.slice(start, index + 1);
  }
  return undefined;
}

export function splitCohubPromptCommand(command: AgentCommand): {
  command: string;
  globalArgs: string[];
  promptArgs: string[];
} {
  const promptIndex = command.args.findIndex((arg) => arg === 'prompt');
  if (promptIndex < 0) {
    throw new Error('Cohub command must contain the prompt subcommand.');
  }
  const spacesPrefix = command.args[promptIndex - 1] === 'spaces' ? 1 : 0;
  return {
    command: command.command,
    globalArgs: command.args.slice(0, promptIndex - spacesPrefix),
    promptArgs: command.args.slice(promptIndex + 1),
  };
}

export class TerminalPromptDecoder {
  private buffer = '';
  private controlPrefix = '';
  private inBracketedPaste = false;
  private previousWasCarriageReturn = false;

  feed(chunk: string): { interrupted: boolean; prompts: string[] } {
    const prompts: string[] = [];
    let interrupted = false;
    const input = this.controlPrefix + chunk;
    this.controlPrefix = '';
    for (let index = 0; index < input.length; index += 1) {
      const remaining = input.slice(index);
      const marker = this.inBracketedPaste ? '\u001b[201~' : '\u001b[200~';
      if (remaining.startsWith(marker)) {
        this.inBracketedPaste = !this.inBracketedPaste;
        index += marker.length - 1;
        continue;
      }
      if (marker.startsWith(remaining)) {
        this.controlPrefix = remaining;
        break;
      }
      const char = input[index];
      if (char === '\u0003') {
        interrupted = true;
        continue;
      }
      if (char === '\u007f') {
        this.buffer = [...this.buffer].slice(0, -1).join('');
        continue;
      }
      if (!this.inBracketedPaste && (char === '\r' || char === '\n')) {
        if (char === '\n' && this.previousWasCarriageReturn) {
          this.previousWasCarriageReturn = false;
          continue;
        }
        this.previousWasCarriageReturn = char === '\r';
        const prompt = this.buffer.trim();
        this.buffer = '';
        if (prompt) prompts.push(prompt);
        continue;
      }
      this.previousWasCarriageReturn = false;
      this.buffer += char;
    }
    return { interrupted, prompts };
  }
}

function parseOptions(argv: string[]): AdapterOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid adapter argument near ${key ?? '(end)'}.`);
    }
    values.set(key, value);
  }
  const payload = values.get('--command-payload');
  const cwd = values.get('--cwd');
  const stateFile = values.get('--state-file');
  if (!payload || !cwd || !stateFile) throw new Error('Missing Cohub adapter arguments.');
  const cohubCommand = JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8')
  ) as AgentCommand;
  if (!cohubCommand.command || !Array.isArray(cohubCommand.args)) {
    throw new Error('Invalid Cohub command payload.');
  }
  const initialPrompt = values.get('--initial-prompt');
  return {
    cohubCommand,
    cwd,
    stateFile,
    initialPrompt: initialPrompt
      ? Buffer.from(initialPrompt, 'base64url').toString('utf8')
      : undefined,
  };
}

async function readState(file: string): Promise<AdapterState> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as AdapterState;
  } catch {
    return {};
  }
}

async function writeState(file: string, state: AdapterState): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

function cohubEnvironment(spaceId?: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    COHUB_CLI_AUTO_UPDATE: '0',
    ...(spaceId ? { COHUB_SPACE_ID: spaceId } : {}),
  };
}

function trackChild<T extends ChildProcess>(child: T): T {
  activeChildren.add(child);
  child.once('exit', () => activeChildren.delete(child));
  return child;
}

async function runJson(command: string, args: string[], spaceId?: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = trackChild(
      spawn(command, args, {
        cwd: process.cwd(),
        env: cohubEnvironment(spaceId),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `Cohub exited with code ${code}.`));
        return;
      }
      const json = extractFirstJsonObject(stdout) ?? stdout.trim();
      try {
        resolve(JSON.parse(json));
      } catch {
        reject(new Error(`Cohub returned invalid JSON: ${stdout.trim().slice(0, 500)}`));
      }
    });
  });
}

async function startSandbox(
  command: string,
  globalArgs: string[],
  cwd: string,
  requestedSpaceId?: string
): Promise<{ child: ChildProcess; spaceId: string }> {
  const args = [
    ...globalArgs,
    'sandbox',
    'up',
    cwd,
    ...(requestedSpaceId ? ['--space', requestedSpaceId] : ['--name', `Yoda · ${basename(cwd)}`]),
    '--yes',
    '--json',
  ];
  const child = trackChild(
    spawn(command, args, {
      cwd,
      env: cohubEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  );
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Cohub sandbox startup timed out after 90 seconds.'));
    }, 90_000);
    const finish = (error?: Error, spaceId?: string) => {
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve({ child, spaceId: spaceId! });
    };
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      const json = extractFirstJsonObject(stdout);
      if (!json) return;
      try {
        const result = JSON.parse(json) as { spaceId?: string };
        if (result.spaceId) finish(undefined, result.spaceId);
      } catch {
        // Keep buffering until a complete JSON object is available.
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('error', (error) => finish(error));
    child.once('exit', (code) => {
      finish(
        new Error(
          stderr.trim() || stdout.trim() || `Cohub sandbox exited before ready (code ${code}).`
        )
      );
    });
  });
}

function writeIncrementalText(previous: string, current: string): string {
  if (!current || current === previous) return previous;
  if (current.startsWith(previous)) process.stdout.write(current.slice(previous.length));
  else process.stdout.write(`${previous ? '\n' : ''}${current}`);
  return current;
}

async function waitForTurn(
  command: string,
  globalArgs: string[],
  spaceId: string,
  sessionId: string,
  turnId: string
): Promise<void> {
  let renderedText = '';
  while (!shuttingDown) {
    const result = (await runJson(
      command,
      [...globalArgs, 'spaces', 'sessions', 'turns', 'ls', sessionId, '--limit', '10', '--json'],
      spaceId
    )) as { turns?: CohubTurn[] };
    const turn = result.turns?.find((candidate) => candidate.id === turnId);
    if (turn) {
      renderedText = writeIncrementalText(renderedText, turn.assistantText?.trimEnd() ?? '');
      if (turn.status === 'completed') {
        process.stdout.write('\n');
        return;
      }
      if (turn.status === 'failed' || turn.status === 'cancelled') {
        throw new Error(turn.errorMessage?.trim() || `Cohub turn ${turn.status}.`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
}

async function sendTurn(
  options: AdapterOptions,
  state: AdapterState,
  prompt: string
): Promise<void> {
  const { command, globalArgs, promptArgs } = splitCohubPromptCommand(options.cohubCommand);
  process.stdout.write('\nCohub 正在处理…\n\n');
  const result = (await runJson(
    command,
    [
      ...globalArgs,
      'prompt',
      ...promptArgs,
      ...(state.sessionId ? ['--session', state.sessionId] : []),
      '--json',
      prompt,
    ],
    state.spaceId
  )) as CohubPromptResult;
  const sessionId = result.session?.id;
  const turnId = result.turn?.id;
  if (!sessionId) throw new Error('Cohub prompt response did not include a session ID.');
  if (!turnId) throw new Error('Cohub prompt response did not include a turn ID.');
  state.sessionId = sessionId;
  await writeState(options.stateFile, state);
  await waitForTurn(command, globalArgs, state.spaceId!, sessionId, turnId);
  process.stdout.write('\n✓ Cohub 已完成\n\nCohub 已就绪，等待下一条消息\n> ');
}

function stopChildren(): void {
  shuttingDown = true;
  for (const child of activeChildren) child.kill('SIGTERM');
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  process.chdir(options.cwd);
  const state = await readState(options.stateFile);
  const parsedCommand = splitCohubPromptCommand(options.cohubCommand);
  const configuredSpaceId = process.env.COHUB_SPACE_ID?.trim();
  let sandbox: ChildProcess | undefined;

  if (configuredSpaceId) {
    if (state.spaceId !== configuredSpaceId) delete state.sessionId;
    state.spaceId = configuredSpaceId;
    await writeState(options.stateFile, state);
    process.stdout.write(`✓ Cohub Space 已连接：${configuredSpaceId}\n`);
  } else {
    try {
      const started = await startSandbox(
        parsedCommand.command,
        parsedCommand.globalArgs,
        options.cwd,
        state.spaceId
      );
      sandbox = started.child;
      state.spaceId = started.spaceId;
    } catch (error) {
      if (!state.spaceId) throw error;
      delete state.spaceId;
      delete state.sessionId;
      const started = await startSandbox(
        parsedCommand.command,
        parsedCommand.globalArgs,
        options.cwd
      );
      sandbox = started.child;
      state.spaceId = started.spaceId;
    }
    await writeState(options.stateFile, state);
    process.stdout.write(`✓ Cohub sandbox 已连接：${state.spaceId}\n`);
  }

  const decoder = new TerminalPromptDecoder();
  let queue = Promise.resolve();
  const enqueue = (prompt: string) => {
    queue = queue
      .then(() => sendTurn(options, state, prompt))
      .catch((error) => {
        process.stderr.write(
          `\n[Cohub][TURN_FAILED] ${error instanceof Error ? error.message : String(error)}\n`
        );
        process.stdout.write('\nCohub 已就绪，等待重试\n> ');
      });
  };

  process.stdin.setEncoding('utf8');
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (chunk: string) => {
    const result = decoder.feed(chunk);
    if (result.interrupted) {
      stopChildren();
      process.exit(130);
    }
    for (const prompt of result.prompts) enqueue(prompt);
  });

  if (options.initialPrompt?.trim()) enqueue(options.initialPrompt);
  else process.stdout.write('\nCohub 已就绪，等待下一条消息\n> ');

  sandbox?.once('exit', (code, signal) => {
    if (!shuttingDown) {
      process.stderr.write(
        `\n[Cohub][SANDBOX_EXITED] 本地 sandbox 已停止（${signal ?? `code ${code}`}）\n`
      );
    }
  });
}

process.once('SIGINT', () => {
  stopChildren();
  process.exit(130);
});
process.once('SIGTERM', () => {
  stopChildren();
  process.exit(143);
});

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) {
  void main().catch((error) => {
    process.stderr.write(
      `[Cohub][ADAPTER_FAILED] ${error instanceof Error ? error.message : String(error)}\n`
    );
    stopChildren();
    process.exit(1);
  });
}
