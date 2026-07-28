import { defineEvent } from '@shared/ipc/events';

export const PTY_CONSUMER_HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * A monotonically ordered batch of PTY output.
 *
 * generation changes whenever a session id is registered with a new backend
 * PTY. sequence is local to that generation. Together they let renderers
 * bridge the subscribe snapshot/live-event boundary without losing or
 * duplicating bytes, and discard late events from a previous process.
 */
export type PtyDataEvent = {
  generation: number;
  sequence: number;
  byteLength: number;
  data: string;
};

// 'pty:data' matches the channel name consumed by TerminalSessionManager.
export const ptyDataChannel = defineEvent<PtyDataEvent>('pty:data');

export type PtyExitEvent = {
  exitCode?: number;
  signal?: number | string;
};

export const ptyExitChannel = defineEvent<PtyExitEvent>('pty:exit');

export const ptyInputChannel = defineEvent<string>('pty:input');
