type ExtensionAPI = {
  on(event: 'agent_end', handler: () => unknown): void;
  on(event: 'session_shutdown', handler: (event: { reason: string }) => unknown): void;
};

async function notifyYoda(
  eventType: 'stop' | 'error' | 'notification',
  body: Record<string, unknown> = {}
) {
  const port = process.env.YODA_HOOK_PORT;
  const token = process.env.YODA_HOOK_TOKEN;
  const ptyId = process.env.YODA_PTY_ID;

  if (!port || !token || !ptyId) return;

  try {
    await fetch(`http://127.0.0.1:${port}/hook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Yoda-Token': token,
        'X-Yoda-Pty-Id': ptyId,
        'X-Yoda-Event-Type': eventType,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Yoda may not be running when pi is launched directly; ignore hook failures.
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Pi exited with an error';
}

export default function (pi: ExtensionAPI) {
  pi.on('agent_end', async () => {
    await notifyYoda('stop', { message: 'Task completed' });
  });

  pi.on('session_shutdown', async (event) => {
    if (event.reason !== 'quit') return;
    await notifyYoda('stop', { message: 'Session ended' });
  });

  process.once('uncaughtException', (error) => {
    void notifyYoda('error', { message: errorMessage(error) });
  });

  process.once('unhandledRejection', (reason) => {
    void notifyYoda('error', { message: errorMessage(reason) });
  });
}
