import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getRuntime, getRuntimeAccountProfile, type RuntimeId } from '@shared/runtime-registry';
import { escapeAppleScriptString } from '@main/core/app/utils';
import { log } from '@main/lib/logger';
import { buildExternalToolEnv } from '@main/utils/childProcessEnv';

const execFileAsync = promisify(execFile);

export type SubscriptionLoginLaunch = {
  runtimeId: RuntimeId;
  command: string;
};

type LaunchAttempt = {
  file: string;
  args: string[];
};

function keepOpenCommand(command: string): string {
  return `${command}; printf '\\n'; printf 'Press Enter to close...'; read _`;
}

async function launchDarwin(command: string): Promise<void> {
  const escaped = escapeAppleScriptString(command);
  await execFileAsync(
    'osascript',
    [
      '-e',
      `tell application "Terminal" to do script "${escaped}"`,
      '-e',
      'tell application "Terminal" to activate',
    ],
    {
      env: buildExternalToolEnv(),
      timeout: 30_000,
    }
  );
}

async function launchWindows(command: string): Promise<void> {
  await execFileAsync('cmd.exe', ['/c', 'start', '', 'cmd.exe', '/k', command], {
    env: buildExternalToolEnv(),
    timeout: 30_000,
    windowsHide: true,
  });
}

async function launchLinux(command: string): Promise<void> {
  const shellCommand = keepOpenCommand(command);
  const attempts: LaunchAttempt[] = [
    { file: 'x-terminal-emulator', args: ['-e', 'sh', '-lc', shellCommand] },
    { file: 'gnome-terminal', args: ['--', 'sh', '-lc', shellCommand] },
    { file: 'konsole', args: ['-e', 'sh', '-lc', shellCommand] },
    { file: 'xterm', args: ['-e', 'sh', '-lc', shellCommand] },
  ];

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      await execFileAsync(attempt.file, attempt.args, {
        env: buildExternalToolEnv(),
        timeout: 30_000,
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error('No supported terminal application is available.');
}

async function launchLoginCommand(command: string): Promise<void> {
  switch (process.platform) {
    case 'darwin':
      await launchDarwin(command);
      return;
    case 'win32':
      await launchWindows(command);
      return;
    case 'linux':
      await launchLinux(command);
      return;
    default:
      throw new Error(`Subscription login is not supported on ${process.platform}.`);
  }
}

export async function startSubscriptionLogin(id: RuntimeId): Promise<SubscriptionLoginLaunch> {
  const profile = getRuntimeAccountProfile(id);
  const command = profile.officialSubscription.loginCommand?.trim();
  if (!profile.officialSubscription.supported || !command) {
    const runtimeName = getRuntime(id)?.name ?? id;
    throw new Error(`${runtimeName} does not expose a supported subscription login command.`);
  }

  log.info('[runtimeSettings] Starting subscription login command', { runtimeId: id, command });
  await launchLoginCommand(command);
  return { runtimeId: id, command };
}
