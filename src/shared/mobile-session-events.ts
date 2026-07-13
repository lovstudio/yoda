import type { MobileSessionRuntimeStatus } from './mobile-api';

export const MOBILE_SESSION_EVENT_NAME = 'session-invalidated';
export const MOBILE_SESSION_EVENT_VERSION = 1 as const;
export const MOBILE_SESSION_EVENT_MAX_BUFFER_CHARS = 1024 * 1024;

export type MobileSessionInvalidationReason = 'connected' | 'transcript-changed' | 'status-changed';

export type MobileSessionInvalidation = {
  version: typeof MOBILE_SESSION_EVENT_VERSION;
  conversationId: string;
  reason: MobileSessionInvalidationReason;
  emittedAt: string;
  runtimeStatus?: MobileSessionRuntimeStatus;
};

export type MobileServerSentEvent = {
  event?: string;
  id?: string;
  retry?: number;
  data: string;
};

export function encodeMobileServerSentEvent({
  event,
  id,
  retry,
  data,
}: MobileServerSentEvent): string {
  const lines: string[] = [];
  if (id !== undefined) lines.push(`id: ${id.replace(/[\r\n]/g, '')}`);
  if (event !== undefined) lines.push(`event: ${event.replace(/[\r\n]/g, '')}`);
  if (retry !== undefined) lines.push(`retry: ${Math.max(0, Math.floor(retry))}`);
  for (const line of data.split(/\r?\n/)) lines.push(`data: ${line}`);
  return `${lines.join('\n')}\n\n`;
}

export class MobileServerSentEventParser {
  private buffer = '';

  push(chunk: string): MobileServerSentEvent[] {
    this.buffer += chunk;
    if (this.buffer.length > MOBILE_SESSION_EVENT_MAX_BUFFER_CHARS) {
      this.buffer = '';
      throw new Error('Mobile session event stream frame exceeded the buffer limit.');
    }

    const events: MobileServerSentEvent[] = [];
    while (true) {
      const boundary = /\r?\n\r?\n/.exec(this.buffer);
      if (!boundary || boundary.index === undefined) break;
      const frame = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.index + boundary[0].length);
      const parsed = parseFrame(frame);
      if (parsed) events.push(parsed);
    }
    return events;
  }

  reset(): void {
    this.buffer = '';
  }
}

export function parseMobileSessionInvalidation(
  frame: MobileServerSentEvent
): MobileSessionInvalidation | null {
  if (frame.event !== MOBILE_SESSION_EVENT_NAME) return null;

  let value: unknown;
  try {
    value = JSON.parse(frame.data);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (value.version !== MOBILE_SESSION_EVENT_VERSION) return null;
  if (typeof value.conversationId !== 'string' || !value.conversationId) return null;
  if (!isInvalidationReason(value.reason)) return null;
  if (typeof value.emittedAt !== 'string' || !value.emittedAt) return null;
  if (value.runtimeStatus !== undefined && !isRuntimeStatus(value.runtimeStatus)) return null;

  return {
    version: MOBILE_SESSION_EVENT_VERSION,
    conversationId: value.conversationId,
    reason: value.reason,
    emittedAt: value.emittedAt,
    ...(value.runtimeStatus === undefined ? {} : { runtimeStatus: value.runtimeStatus }),
  };
}

function parseFrame(frame: string): MobileServerSentEvent | null {
  let event: string | undefined;
  let id: string | undefined;
  let retry: number | undefined;
  const data: string[] = [];

  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') event = value;
    else if (field === 'id' && !value.includes('\0')) id = value;
    else if (field === 'data') data.push(value);
    else if (field === 'retry' && /^\d+$/.test(value)) retry = Number(value);
  }

  if (data.length === 0) return null;
  return { event, id, retry, data: data.join('\n') };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isInvalidationReason(value: unknown): value is MobileSessionInvalidationReason {
  return value === 'connected' || value === 'transcript-changed' || value === 'status-changed';
}

function isRuntimeStatus(value: unknown): value is MobileSessionRuntimeStatus {
  return (
    value === 'idle' ||
    value === 'working' ||
    value === 'awaiting-input' ||
    value === 'error' ||
    value === 'completed'
  );
}
