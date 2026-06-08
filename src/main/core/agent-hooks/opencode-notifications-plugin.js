/* global fetch, process */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const YodaNotifications = async () => ({
  event: async ({ event }) => {
    // Read the live hook endpoint at fire-time so it survives main-process
    // restarts (a captured YODA_HOOK_PORT env would go stale).
    const endpoint = readYodaHookEndpoint();
    const ptyId = process.env.YODA_PTY_ID;
    if (!endpoint || !ptyId) return;
    const { port, token } = endpoint;

    const payload = toYodaPayload(event);
    if (!payload) return;

    try {
      await fetch(`http://127.0.0.1:${port}/hook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Yoda-Token': token,
          'X-Yoda-Pty-Id': ptyId,
          'X-Yoda-Event-Type': payload.type,
        },
        body: JSON.stringify(payload.body),
      });
    } catch {
      // Hook delivery is best-effort and must never interrupt OpenCode.
    }
  },
});

function readYodaHookEndpoint() {
  try {
    const file = join(homedir(), '.yoda', 'hook-endpoint.json');
    const { port, token } = JSON.parse(readFileSync(file, 'utf8'));
    if (!port || !token) return undefined;
    return { port, token };
  } catch {
    return undefined;
  }
}

function toYodaPayload(event) {
  if (event.type === 'session.idle') {
    return {
      type: 'notification',
      body: {
        notification_type: 'idle_prompt',
        title: 'OpenCode',
        message: 'OpenCode is ready for input.',
      },
    };
  }

  if (event.type === 'session.error') {
    return {
      type: 'error',
      body: {
        title: 'OpenCode error',
        message: typeof event.properties?.error === 'string' ? event.properties.error : undefined,
      },
    };
  }

  return undefined;
}
