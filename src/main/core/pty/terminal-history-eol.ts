/**
 * Plain-text transcript history is not produced by a PTY, so its bare LF
 * separators need an explicit carriage return before replay into xterm.
 * Live local/SSH PTY output must bypass this conversion.
 */
export function normalizePlainTextTerminalEol(value: string): string {
  return value.replace(/\r?\n/g, '\r\n');
}
