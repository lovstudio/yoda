import { join } from 'node:path';
import { app } from 'electron';
import type { AgentCommand } from './impl/agent-command';

export type CohubAdapterPaths = {
  appPath: string;
  execPath: string;
  userDataPath: string;
};

function defaultPaths(): CohubAdapterPaths {
  return {
    appPath: app.getAppPath(),
    execPath: process.execPath,
    userDataPath: app.getPath('userData'),
  };
}

export function buildCohubAdapterCommand(
  input: {
    cohubCommand: AgentCommand;
    conversationId: string;
    cwd: string;
    initialPrompt?: string;
  },
  paths: CohubAdapterPaths = defaultPaths()
): AgentCommand {
  const payload = Buffer.from(JSON.stringify(input.cohubCommand), 'utf8').toString('base64url');
  const stateFile = join(paths.userDataPath, 'cohub', 'sessions', `${input.conversationId}.json`);
  const args = [
    join(paths.appPath, 'out', 'main', 'cohub-runtime-adapter.js'),
    '--command-payload',
    payload,
    '--state-file',
    stateFile,
    '--cwd',
    input.cwd,
  ];
  if (input.initialPrompt?.trim()) {
    args.push('--initial-prompt', Buffer.from(input.initialPrompt, 'utf8').toString('base64url'));
  }
  return { command: paths.execPath, args };
}

export function getCohubAdapterEnvironment(): Record<string, string> {
  return {
    COHUB_CLI_AUTO_UPDATE: '0',
    ELECTRON_RUN_AS_NODE: '1',
  };
}
