import type http from 'node:http';
import {
  encodeMobileServerSentEvent,
  MOBILE_SESSION_EVENT_NAME,
  type MobileSessionInvalidation,
} from '@shared/mobile-session-events';

export const MOBILE_SESSION_HEARTBEAT_INTERVAL_MS = 15_000;
export const MOBILE_SESSION_RECONNECT_RETRY_MS = 1_000;

export class MobileSessionEventStream {
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private started = false;
  private closed = false;

  constructor(
    private readonly req: http.IncomingMessage,
    private readonly res: http.ServerResponse,
    private readonly nextEventId: () => string,
    private readonly onClose: () => void
  ) {
    this.req.once('aborted', this.close);
    this.res.once('close', this.close);
    this.res.once('error', this.handleError);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  start(): boolean {
    if (this.closed || this.started || this.res.destroyed || this.res.writableEnded) return false;
    this.started = true;
    this.req.socket.setTimeout(0);
    this.req.socket.setKeepAlive(true);
    this.res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    });
    this.res.flushHeaders();
    this.heartbeatTimer = setInterval(() => {
      this.write(`: heartbeat ${Date.now()}\n\n`);
    }, MOBILE_SESSION_HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
    return true;
  }

  send(event: MobileSessionInvalidation, retry?: number): boolean {
    if (!this.started || this.closed) return false;
    return this.write(
      encodeMobileServerSentEvent({
        id: this.nextEventId(),
        event: MOBILE_SESSION_EVENT_NAME,
        data: JSON.stringify(event),
        retry,
      })
    );
  }

  close = (endResponse = true): void => {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.req.removeListener('aborted', this.close);
    this.res.removeListener('close', this.close);
    this.res.removeListener('error', this.handleError);
    this.onClose();
    if (endResponse && !this.res.destroyed && !this.res.writableEnded) this.res.end();
  };

  private write(value: string): boolean {
    if (this.closed || this.res.destroyed || this.res.writableEnded) {
      this.close();
      return false;
    }
    try {
      const accepted = this.res.write(value);
      if (accepted) return true;
      // Invalidation events are recoverable: reconnect sends `connected` and
      // forces a fresh detail snapshot. Closing is safer than buffering an
      // unbounded stream for a slow or backgrounded mobile client.
      this.close();
      return false;
    } catch {
      this.close();
      return false;
    }
  }

  private handleError = (): void => this.close();
}
