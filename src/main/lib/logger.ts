import { createLogger, installBrokenConsolePipeHandler } from '@shared/logger';
import { appendLogLine } from './log-file';

installBrokenConsolePipeHandler(process.stdout);
installBrokenConsolePipeHandler(process.stderr);

export const log = createLogger({
  envLevel: process.env.LOG_LEVEL,
  debugFlag: process.argv.includes('--debug-logs'),
  sink: (level, input) => appendLogLine('main', level, input),
});

export type Logger = ReturnType<typeof createLogger>;
