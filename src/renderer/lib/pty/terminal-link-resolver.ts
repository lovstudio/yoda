import type { Terminal } from '@xterm/xterm';
import {
  getTerminalFileLinkAtCell,
  registerTerminalFileLinkProvider,
  type TerminalFileLinkOptions,
} from './terminal-file-links';
import type { TerminalLinkCellPosition, TerminalLinkTarget } from './terminal-link-target';
import {
  getTerminalWebLinkAtCell,
  registerTerminalWebLinkProvider,
  type TerminalWebLinkOptions,
} from './terminal-web-links';

/**
 * Resolves the semantic target at a terminal cell.
 *
 * A wrapped URL tail such as `secret.html` is also a valid-looking filename.
 * Prefer the complete URL match so every visible fragment has the same target,
 * then fall back to file-path behavior for genuine terminal paths.
 */
export function getTerminalLinkTargetAtCell(
  terminal: Terminal,
  bufferLineNumber: number,
  position: TerminalLinkCellPosition,
  fileOptions: TerminalFileLinkOptions | null
): TerminalLinkTarget | null {
  const webMatch = getTerminalWebLinkAtCell(terminal, bufferLineNumber, position);
  if (webMatch) return { kind: 'url', url: webMatch.url };

  if (!fileOptions) return null;
  const fileMatch = getTerminalFileLinkAtCell(terminal, bufferLineNumber, position, fileOptions);
  return fileMatch ? { kind: 'file', target: fileMatch.target } : null;
}

/**
 * Provider registration order is priority order in xterm. Keep web links ahead
 * of file links for the same reason as getTerminalLinkTargetAtCell above.
 */
export function registerTerminalLinkProviders(
  terminal: Terminal,
  getFileOptions: () => TerminalFileLinkOptions | null,
  getWebOptions: () => TerminalWebLinkOptions | null
): { dispose: () => void } {
  const webProvider = registerTerminalWebLinkProvider(terminal, getWebOptions);
  const fileProvider = registerTerminalFileLinkProvider(terminal, getFileOptions);

  return {
    dispose: () => {
      fileProvider.dispose();
      webProvider.dispose();
    },
  };
}
