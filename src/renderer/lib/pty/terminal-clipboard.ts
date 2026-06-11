import type { IDisposable, Terminal } from '@xterm/xterm';
import { rpc } from '@renderer/lib/ipc';

/**
 * Write text to the system clipboard via the main process (works regardless
 * of renderer focus state), falling back to navigator.clipboard.
 */
export function writeTextToClipboard(text: string): void {
  void rpc.app
    .clipboardWriteText(text)
    .then((result) => {
      if (result?.success) return;
      return navigator.clipboard?.writeText(text);
    })
    .catch(() => navigator.clipboard?.writeText(text).catch(() => {}));
}

/**
 * Handle OSC 52 clipboard writes from programs running inside the PTY —
 * e.g. tmux copy-mode (set-clipboard external/on) emits OSC 52 when a mouse
 * selection is copied. Without this handler xterm.js silently drops the
 * sequence and the selection never reaches the system clipboard.
 *
 * Payload format (after "OSC 52;"): "<selection chars>;<base64 text>".
 * A "?" payload is a clipboard *read* request, which we deliberately do not
 * support (leaking the clipboard to arbitrary PTY programs).
 */
export function registerOsc52ClipboardHandler(terminal: Terminal): IDisposable {
  return terminal.parser.registerOscHandler(52, (data) => {
    const separator = data.indexOf(';');
    if (separator === -1) return true;
    const payload = data.slice(separator + 1);
    // "?" = read request (unsupported); "!" / empty = clear (ignored).
    if (!payload || payload === '?') return true;
    try {
      const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
      writeTextToClipboard(new TextDecoder().decode(bytes));
    } catch {
      // Malformed base64 — drop it.
    }
    return true;
  });
}
