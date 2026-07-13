import { fetch as expoFetch } from 'expo/fetch';
import {
  MobileServerSentEventParser,
  parseMobileSessionInvalidation,
  type MobileSessionInvalidation,
} from '../../../src/shared/mobile-session-events';
import { mobileApiHeaders, mobileApiUrl, type MobileConnection } from './api-client';

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 15_000;
const CONNECTION_TIMEOUT_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;

export type SessionEventStreamState = 'connecting' | 'open' | 'retrying' | 'closed';

export type SessionEventHandlers = {
  onInvalidated: (event: MobileSessionInvalidation) => void;
  onStateChange?: (state: SessionEventStreamState) => void;
  onError?: (error: Error) => void;
};

class TerminalSessionEventError extends Error {}

export function subscribeSessionEvents(
  connection: MobileConnection,
  projectId: string,
  taskId: string,
  conversationId: string,
  handlers: SessionEventHandlers
): () => void {
  let stopped = false;
  let controller: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;

  const connect = async (): Promise<void> => {
    if (stopped) return;
    handlers.onStateChange?.('connecting');
    const nextController = new AbortController();
    controller = nextController;
    let transportTimedOut = false;
    let connectionTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      transportTimedOut = true;
      nextController.abort();
    }, CONNECTION_TIMEOUT_MS);
    let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
    const clearTransportTimers = () => {
      if (connectionTimer) clearTimeout(connectionTimer);
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      connectionTimer = null;
      heartbeatTimer = null;
    };
    const armHeartbeatTimeout = () => {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      heartbeatTimer = setTimeout(() => {
        transportTimedOut = true;
        nextController.abort();
      }, HEARTBEAT_TIMEOUT_MS);
    };

    try {
      const path = `/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/sessions/${encodeURIComponent(conversationId)}/events`;
      const response = await expoFetch(mobileApiUrl(connection, path), {
        headers: mobileApiHeaders(connection, { Accept: 'text/event-stream' }),
        signal: nextController.signal,
      });
      if (connectionTimer) clearTimeout(connectionTimer);
      connectionTimer = null;
      if (response.status === 401 || response.status === 403) {
        throw new TerminalSessionEventError(
          connection.baseUrl.startsWith('https://')
            ? 'Yoda Relay credential is no longer valid. Pair this phone again.'
            : 'Desktop rejected the mobile gateway token. Rescan the desktop mobile QR.'
        );
      }
      if (response.status === 402) {
        throw new TerminalSessionEventError(
          'Yoda Relay Pass is not active. Renew it from the desktop account settings.'
        );
      }
      if (response.status === 404) {
        throw new TerminalSessionEventError(
          'This desktop version does not expose live mobile session events.'
        );
      }
      if (!response.ok) throw new Error(`Live session stream failed with ${response.status}.`);
      if (!response.body) throw new Error('Live session stream did not provide a response body.');

      handlers.onStateChange?.('open');
      armHeartbeatTimeout();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = new MobileServerSentEventParser();

      const processFrames = (text: string) => {
        for (const frame of parser.push(text)) {
          if (frame.retry !== undefined) {
            reconnectDelay = Math.min(MAX_RECONNECT_DELAY_MS, Math.max(0, frame.retry));
          }
          const event = parseMobileSessionInvalidation(frame);
          if (!event || event.conversationId !== conversationId || stopped) continue;
          if (event.reason === 'connected') reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
          try {
            handlers.onInvalidated(event);
          } catch {
            // A view callback must not tear down the transport.
          }
        }
      };

      while (!stopped && !nextController.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) {
          processFrames(decoder.decode());
          break;
        }
        armHeartbeatTimeout();
        processFrames(decoder.decode(value, { stream: true }));
      }
      if (!stopped && !nextController.signal.aborted) {
        throw new Error('Live session stream disconnected.');
      }
    } catch (error) {
      if (stopped || (nextController.signal.aborted && !transportTimedOut)) return;
      const normalized = transportTimedOut
        ? new Error('Live session stream timed out.')
        : error instanceof Error
          ? error
          : new Error(String(error));
      if (normalized instanceof TerminalSessionEventError) {
        if (!nextController.signal.aborted) nextController.abort();
        handlers.onError?.(normalized);
        handlers.onStateChange?.('closed');
        return;
      }
      if (!nextController.signal.aborted) nextController.abort();
      handlers.onStateChange?.('retrying');
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, reconnectDelay);
      reconnectDelay = Math.min(MAX_RECONNECT_DELAY_MS, reconnectDelay * 2);
    } finally {
      clearTransportTimers();
      if (controller === nextController) controller = null;
    }
  };

  void connect();
  return () => {
    if (stopped) return;
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    controller?.abort();
    controller = null;
    handlers.onStateChange?.('closed');
  };
}
