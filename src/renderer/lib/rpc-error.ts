/**
 * Electron rejects an `ipcMain.handle` failure with a synthetic Error whose message
 * is wrapped as `Error invoking remote method 'ns.proc': Error: <original>` — and it
 * drops every custom property off the original, so the message is the only channel a
 * main-process error has. Strip the transport wrapper before showing it to a user.
 */
const REMOTE_METHOD_ERROR_PREFIX = /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i;

export function rpcErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(REMOTE_METHOD_ERROR_PREFIX, '').trim();
}
