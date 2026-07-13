import type { PlatformConfig } from '@shared/openInApps';
import { quoteShellArg } from './shellEscape';

export type OpenFileLocation = {
  line: number;
  column?: number;
};

const PATH_TEMPLATE_TOKEN_RE = /\{\{path(?:_location)?(?:_raw)?\}\}/g;

export function normalizeOpenFileLocation(
  line: number | undefined,
  column: number | undefined
): OpenFileLocation | null {
  if (line === undefined) {
    if (column === undefined) return null;
    throw new Error('A file column requires a line.');
  }
  if (!Number.isInteger(line) || line < 1) throw new Error('Invalid file line.');
  if (column !== undefined && (!Number.isInteger(column) || column < 1)) {
    throw new Error('Invalid file column.');
  }
  return column === undefined ? { line } : { line, column };
}

export function buildLocalOpenCommand(
  platformConfig: PlatformConfig | undefined,
  target: string,
  location: OpenFileLocation | null
): string {
  const locationTarget = location
    ? `${target}:${location.line}${location.column === undefined ? '' : `:${location.column}`}`
    : target;
  const templates =
    location && platformConfig?.openLocationCommands?.length
      ? platformConfig.openLocationCommands
      : (platformConfig?.openCommands ?? []);

  return templates
    .map((template) =>
      template.replace(PATH_TEMPLATE_TOKEN_RE, (token) => {
        switch (token) {
          case '{{path_location}}':
            return quoteShellArg(locationTarget);
          case '{{path_location_raw}}':
            return locationTarget;
          case '{{path}}':
            return quoteShellArg(target);
          case '{{path_raw}}':
            return target;
          default:
            return token;
        }
      })
    )
    .join(' || ');
}
