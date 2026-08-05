const TOOL_PREVIEW_MAX_CHARS = 88;

/**
 * Tool inputs are frequently serialized inside JSON or JavaScript wrappers.
 * Restore layout-only escape sequences so the inspector reflects the command
 * or patch structure instead of showing one long line of literal `\\n`s.
 */
export function formatMobileToolTranscriptContent(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\\r\\n|\\n|\\r/g, '\n')
    .replace(/\\t/g, '  ')
    .trimEnd();
}

export function summarizeMobileToolTranscriptContent(value: string): string {
  const firstLine = formatMobileToolTranscriptContent(value)
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) return 'No details';
  return firstLine.length > TOOL_PREVIEW_MAX_CHARS
    ? `${firstLine.slice(0, TOOL_PREVIEW_MAX_CHARS)}…`
    : firstLine;
}
