import { execSync, type ExecSyncOptions } from 'node:child_process';

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Print the command before running it */
  echo?: boolean;
}

interface ExecFailure {
  status?: number | null;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

function capturedOutput(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8').trim();
  }
  return '';
}

function formatCapturedOutput(label: 'stdout' | 'stderr', value: unknown): string | null {
  const output = capturedOutput(value);
  return output ? `${label}:\n${output}` : null;
}

export function exec(cmd: string, opts?: ExecOptions): string {
  if (opts?.echo) {
    console.log(`$ ${cmd}`);
  }
  const execOpts: ExecSyncOptions = {
    encoding: 'utf-8',
    stdio: ['inherit', 'pipe', 'pipe'],
    ...(opts?.cwd && { cwd: opts.cwd }),
    ...(opts?.env && { env: { ...process.env, ...opts.env } }),
  };
  try {
    return (execSync(cmd, execOpts) as string).trim();
  } catch (error: unknown) {
    const failure = error as ExecFailure;
    const output = [
      formatCapturedOutput('stdout', failure.stdout),
      formatCapturedOutput('stderr', failure.stderr),
    ]
      .filter((entry): entry is string => entry !== null)
      .join('\n');
    const details = output ? `\n${output}` : '';
    throw new Error(`Command failed (exit ${failure.status ?? '?'}): ${cmd}${details}`);
  }
}

export function execOrNull(cmd: string, opts?: ExecOptions): string | null {
  try {
    return exec(cmd, opts);
  } catch {
    return null;
  }
}
