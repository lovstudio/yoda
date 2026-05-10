/* global fetch, process */

export const YodaNotifications = async () => ({
  event: async ({ event }) => {
    const port = process.env.YODA_HOOK_PORT;
    const token = process.env.YODA_HOOK_TOKEN;
    const ptyId = process.env.YODA_PTY_ID;
    if (!port || !token || !ptyId) return;

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
