import type { Client, ClientChannel } from 'ssh2';

export const SSH_EXEC_CHANNEL_OPEN_CONCURRENCY = 8;

type ChannelOpenState = 'queued' | 'opening' | 'done';

type PendingChannelOpen = {
  command: string;
  signal: AbortSignal;
  state: ChannelOpenState;
  aborted: boolean;
  settled: boolean;
  resolve: (stream: ClientChannel) => void;
  reject: (error: unknown) => void;
  onAbort: () => void;
};

type ClientChannelOpenLimiter = {
  active: number;
  queue: PendingChannelOpen[];
};

const limiters = new WeakMap<Client, ClientChannelOpenLimiter>();

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError');
}

function settleRejected(entry: PendingChannelOpen, error: unknown): void {
  if (entry.settled) return;
  entry.settled = true;
  entry.reject(error);
}

function removeQueuedEntry(
  client: Client,
  limiter: ClientChannelOpenLimiter,
  entry: PendingChannelOpen
): void {
  const index = limiter.queue.indexOf(entry);
  if (index >= 0) limiter.queue.splice(index, 1);
  if (limiter.active === 0 && limiter.queue.length === 0) limiters.delete(client);
}

function drain(client: Client, limiter: ClientChannelOpenLimiter): void {
  while (limiter.active < SSH_EXEC_CHANNEL_OPEN_CONCURRENCY) {
    const entry = limiter.queue.shift();
    if (!entry) break;
    if (entry.signal.aborted || entry.aborted) {
      entry.state = 'done';
      entry.signal.removeEventListener('abort', entry.onAbort);
      settleRejected(entry, abortReason(entry.signal));
      continue;
    }
    startChannelOpen(client, limiter, entry);
  }

  if (limiter.active === 0 && limiter.queue.length === 0) limiters.delete(client);
}

function startChannelOpen(
  client: Client,
  limiter: ClientChannelOpenLimiter,
  entry: PendingChannelOpen
): void {
  entry.state = 'opening';
  limiter.active += 1;
  let callbackReturned = false;

  const releaseOpenSlot = () => {
    if (callbackReturned) return;
    callbackReturned = true;
    limiter.active -= 1;
    drain(client, limiter);
  };

  try {
    client.exec(entry.command, (error, stream) => {
      if (callbackReturned) {
        if (entry.signal.aborted && stream) {
          try {
            stream.destroy();
          } catch {}
        }
        return;
      }

      entry.state = 'done';
      entry.signal.removeEventListener('abort', entry.onAbort);

      // A caller can time out while ssh2 is still opening the channel. Its
      // public Promise rejects immediately, but the slot remains occupied until
      // this callback proves the open attempt has actually finished. Destroy a
      // channel that arrives after cancellation before admitting queued work.
      if (entry.aborted || entry.signal.aborted) {
        if (stream) {
          try {
            stream.destroy();
          } catch {}
        }
        settleRejected(entry, abortReason(entry.signal));
        releaseOpenSlot();
        return;
      }

      if (error) {
        settleRejected(entry, error);
        releaseOpenSlot();
        return;
      }

      if (!stream) {
        settleRejected(entry, new Error('SSH exec returned no channel'));
        releaseOpenSlot();
        return;
      }

      if (!entry.settled) {
        entry.settled = true;
        entry.resolve(stream);
      }
      releaseOpenSlot();
    });
  } catch (error) {
    entry.state = 'done';
    entry.signal.removeEventListener('abort', entry.onAbort);
    settleRejected(entry, error);
    releaseOpenSlot();
  }
}

/**
 * Opens an ssh2 exec channel with a limit shared by every execution context
 * backed by the same live Client instance.
 *
 * Cancellation while queued removes the request, so an expired cleanup never
 * opens a channel later. Cancellation after opening starts rejects the public
 * Promise but deliberately retains its slot until ssh2 invokes the callback.
 */
export function openSshExecChannel(
  client: Client,
  command: string,
  signal: AbortSignal
): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }

    const limiter = limiters.get(client) ?? { active: 0, queue: [] };
    limiters.set(client, limiter);

    const entry = {} as PendingChannelOpen;
    entry.command = command;
    entry.signal = signal;
    entry.state = 'queued';
    entry.aborted = false;
    entry.settled = false;
    entry.resolve = resolve;
    entry.reject = reject;
    entry.onAbort = () => {
      entry.aborted = true;
      settleRejected(entry, abortReason(signal));
      if (entry.state === 'queued') {
        entry.state = 'done';
        signal.removeEventListener('abort', entry.onAbort);
        removeQueuedEntry(client, limiter, entry);
      }
      // When state=opening, keep both the entry and its slot until the ssh2
      // callback returns. Releasing here would allow real channel opens to
      // exceed the limit even though the public Promise already rejected.
    };
    signal.addEventListener('abort', entry.onAbort, { once: true });

    if (limiter.active < SSH_EXEC_CHANNEL_OPEN_CONCURRENCY) {
      startChannelOpen(client, limiter, entry);
    } else {
      limiter.queue.push(entry);
    }
  });
}
