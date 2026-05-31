import { createLogger, installBrokenConsolePipeHandler } from '@shared/logger';

installBrokenConsolePipeHandler(process.stdout);
installBrokenConsolePipeHandler(process.stderr);

export const log = createLogger({
  envLevel: process.env.LOG_LEVEL,
  debugFlag: process.argv.includes('--debug-logs'),
});

export type Logger = ReturnType<typeof createLogger>;
