/**
 * Convert a raw PTY replay buffer into a portable, readable log snapshot.
 *
 * The source buffer intentionally preserves terminal control traffic so xterm
 * can reconstruct the screen. Exported logs should keep the textual output
 * while dropping cursor movement, hyperlinks, title updates, and other control
 * sequences that are only meaningful to a terminal emulator.
 */
export function formatTerminalLogContent(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1bP[\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b_[\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\^[\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[()*+\-./][0-9A-Za-z]/g, '')
    .replace(/\x1b[=>78MDEHc]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}
