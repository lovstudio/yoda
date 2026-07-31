import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { err, ok } from '@shared/result';
import { formatTerminalLogContent } from '@shared/terminal-log';
import { ptySessionRegistry } from './pty-session-registry';

const TERMINAL_LOG_DIRECTORY = 'terminals';

export async function exportTerminalLog(sessionId: string) {
  const diagnostics = ptySessionRegistry.getDiagnostics(sessionId);
  if (!diagnostics) return err({ type: 'not_found' as const });

  const content = formatTerminalLogContent(ptySessionRegistry.snapshot(sessionId));
  const directory = join(app.getPath('userData'), 'logs', TERMINAL_LOG_DIRECTORY);
  const path = join(directory, terminalLogFileName(sessionId));

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(path, content, 'utf8');
  } catch (error) {
    return err({
      type: 'write_failed' as const,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return ok({
    path,
    content,
    capturedAt: new Date().toISOString(),
    contentBytes: Buffer.byteLength(content, 'utf8'),
    ringBufferBytes: diagnostics.ringBufferBytes,
    ringBufferCapBytes: diagnostics.ringBufferCapBytes,
  });
}

export function terminalLogFileName(sessionId: string): string {
  const digest = createHash('sha256').update(sessionId).digest('hex').slice(0, 20);
  return `terminal-${digest}.log`;
}
