import { Buffer } from 'node:buffer';
import {
  ptyDataChannel,
  ptyExitChannel,
  ptyInputChannel,
  type PtyDataEvent,
} from '@shared/events/ptyEvents';
import {
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  getTerminalRingBufferCapBytes,
} from '@shared/terminal-settings';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import type { Pty, PtyExitInfo } from './pty';

const FLUSH_INTERVAL_MS = 16; // One IPC output batch per display frame.
const CONTINUATION_BYTE_MASK = 0xc0;
const CONTINUATION_BYTE_MARKER = 0x80;

// xterm's write buffer warns that a pending queue above 500 KiB can make the
// terminal unresponsive. Pause below that limit and resume with ample
// hysteresis so Ctrl-C/input stays responsive during output floods.
export const PTY_OUTPUT_BATCH_MAX_BYTES = 64 * 1024;
export const PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES = 384 * 1024;
export const PTY_FLOW_CONTROL_LOW_WATERMARK_BYTES = 96 * 1024;
export const PTY_CONSUMER_LEASE_TIMEOUT_MS = 90_000;
const PTY_IMMEDIATE_FLUSH_MAX_BATCHES =
  PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES / PTY_OUTPUT_BATCH_MAX_BYTES;
const PTY_RESUME_RETRY_BASE_MS = 25;
const PTY_RESUME_RETRY_MAX_DELAY_MS = 1_000;
const PTY_PENDING_INPUT_CAP_BYTES = 64 * 1024;
const PTY_PENDING_INPUT_TTL_MS = 30_000;
export const PTY_PENDING_INPUT_MAX_SESSIONS = 128;
export const PTY_PENDING_INPUT_MAX_CHUNKS = 128;

type InflightBatch = {
  sequence: number;
  byteLength: number;
};

type ConsumerState = {
  generation: number;
  acknowledgedSequence: number;
  expiresAt: number;
};

type SessionState = {
  readonly pty: Pty;
  readonly generation: number;
  readonly registrationEpoch: number;
  readonly ringBuffer: Utf8RingBuffer;
  live: boolean;
  sequence: number;
  pendingData: Buffer[];
  pendingDataHead: number;
  pendingByteLength: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
  inputOff: (() => void) | null;
  inflightBatches: InflightBatch[];
  inflightByteLength: number;
  paused: boolean;
  resumeRetryTimer: ReturnType<typeof setTimeout> | null;
  resumeRetryAttempt: number;
  pendingExit: { info: PtyExitInfo; preserveBuffer: boolean } | null;
};

export type PtySubscriptionSnapshot = {
  buffer: string;
  generation: number;
  sequence: number;
};

type PendingInput = {
  epoch: number;
  chunks: string[];
  byteLength: number;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout> | null;
};

type RegistrationIntent = {
  epoch: number;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * A UTF-8 byte-bounded chunk deque.
 *
 * Appends are O(1) and eviction never starts inside a UTF-8 code point. This
 * avoids the repeated full-string concat/slice work and broken surrogate pairs
 * caused by treating JavaScript string.length as bytes.
 */
class Utf8RingBuffer {
  private chunks: Array<{ data: string; byteLength: number }> = [];
  private head = 0;
  private byteLength = 0;

  constructor(private capBytes: number) {}

  setCapBytes(capBytes: number): void {
    this.capBytes = capBytes;
    this.evictToCap();
  }

  append(data: string, knownByteLength?: number): void {
    if (!data) return;
    let byteLength = knownByteLength ?? Buffer.byteLength(data, 'utf8');
    if (byteLength > this.capBytes) {
      data = utf8Tail(data, this.capBytes);
      byteLength = Buffer.byteLength(data, 'utf8');
      this.clear();
    }
    if (!data) return;
    this.chunks.push({ data, byteLength });
    this.byteLength += byteLength;
    this.evictToCap();
  }

  snapshot(): string {
    if (this.head === 0) return this.chunks.map((chunk) => chunk.data).join('');
    return this.chunks
      .slice(this.head)
      .map((chunk) => chunk.data)
      .join('');
  }

  clear(): void {
    this.chunks = [];
    this.head = 0;
    this.byteLength = 0;
  }

  private evictToCap(): void {
    while (this.byteLength > this.capBytes && this.head < this.chunks.length) {
      const overflow = this.byteLength - this.capBytes;
      const chunk = this.chunks[this.head];
      if (chunk.byteLength <= overflow) {
        this.byteLength -= chunk.byteLength;
        this.head += 1;
        continue;
      }

      const tail = utf8Tail(chunk.data, chunk.byteLength - overflow);
      const tailByteLength = Buffer.byteLength(tail, 'utf8');
      this.chunks[this.head] = { data: tail, byteLength: tailByteLength };
      this.byteLength -= chunk.byteLength - tailByteLength;
    }

    // Compact occasionally without doing work on every append.
    if (this.head > 64 && this.head * 2 > this.chunks.length) {
      this.chunks = this.chunks.slice(this.head);
      this.head = 0;
    }
  }
}

function utf8Tail(data: string, capBytes: number): string {
  if (capBytes <= 0) return '';
  const bytes = Buffer.from(data, 'utf8');
  if (bytes.length <= capBytes) return data;

  let start = bytes.length - capBytes;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) {
    start += 1;
  }
  return bytes.subarray(start).toString('utf8');
}

function isValidPtyWatermark(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function takePendingUtf8Batch(
  state: SessionState,
  maxBytes: number
): { data: string; byteLength: number } {
  const parts: Buffer[] = [];
  let byteLength = 0;

  while (byteLength < maxBytes && state.pendingDataHead < state.pendingData.length) {
    const chunk = state.pendingData[state.pendingDataHead];
    const remaining = maxBytes - byteLength;
    if (chunk.length <= remaining) {
      parts.push(chunk);
      byteLength += chunk.length;
      state.pendingDataHead += 1;
      continue;
    }

    let splitAt = remaining;
    while (splitAt > 0 && (chunk[splitAt] & CONTINUATION_BYTE_MASK) === CONTINUATION_BYTE_MARKER) {
      splitAt -= 1;
    }
    if (splitAt === 0) break;

    parts.push(chunk.subarray(0, splitAt));
    state.pendingData[state.pendingDataHead] = chunk.subarray(splitAt);
    byteLength += splitAt;
  }

  if (state.pendingDataHead > 64 && state.pendingDataHead * 2 >= state.pendingData.length) {
    state.pendingData = state.pendingData.slice(state.pendingDataHead);
    state.pendingDataHead = 0;
  }
  state.pendingByteLength = Math.max(0, state.pendingByteLength - byteLength);
  return {
    data: Buffer.concat(parts, byteLength).toString('utf8'),
    byteLength,
  };
}

export class PtySessionRegistry {
  private readonly sessions = new Map<string, SessionState>();
  private readonly generationCounters = new Map<string, number>();
  /** Persists across backend respawns so listener-first renderers stay attached. */
  private readonly consumers = new Map<string, Map<string, ConsumerState>>();
  private readonly pendingInputs = new Map<string, PendingInput>();
  private readonly registrationEpochCounters = new Map<string, number>();
  private readonly registrationIntents = new Map<string, RegistrationIntent>();
  private consumerLeaseTimer: ReturnType<typeof setTimeout> | null = null;
  private ringBufferCapBytes = getTerminalRingBufferCapBytes(DEFAULT_TERMINAL_SCROLLBACK_LINES);

  setScrollbackLines(scrollbackLines: unknown): void {
    this.ringBufferCapBytes = getTerminalRingBufferCapBytes(scrollbackLines);
    for (const state of this.sessions.values()) {
      state.ringBuffer.setCapBytes(this.ringBufferCapBytes);
    }
  }

  beginRegistration(sessionId: string): number {
    const existing = this.registrationIntents.get(sessionId);
    if (existing && existing.expiresAt > Date.now()) return existing.epoch;
    if (existing) this.clearRegistrationIntent(sessionId, existing);

    const epoch = (this.registrationEpochCounters.get(sessionId) ?? 0) + 1;
    this.registrationEpochCounters.set(sessionId, epoch);
    const intent: RegistrationIntent = {
      epoch,
      expiresAt: Date.now() + PTY_PENDING_INPUT_TTL_MS,
      timer: setTimeout(() => {
        if (this.registrationIntents.get(sessionId) !== intent) return;
        this.clearRegistrationIntent(sessionId, intent);
        this.clearPendingInput(sessionId);
      }, PTY_PENDING_INPUT_TTL_MS),
    };
    intent.timer.unref?.();
    this.registrationIntents.set(sessionId, intent);
    return epoch;
  }

  isRegistrationCurrent(sessionId: string, epoch: number): boolean {
    const intent = this.registrationIntents.get(sessionId);
    return intent?.epoch === epoch && intent.expiresAt > Date.now();
  }

  cancelRegistration(sessionId: string, epoch: number): void {
    const intent = this.registrationIntents.get(sessionId);
    if (!intent || intent.epoch !== epoch) return;
    this.clearRegistrationIntent(sessionId, intent);
    this.clearPendingInput(sessionId);
  }

  register(
    sessionId: string,
    pty: Pty,
    options?: { preserveBufferOnExit?: boolean; registrationEpoch?: number }
  ): void {
    const preserveBufferOnExit = options?.preserveBufferOnExit ?? false;
    const previousState = this.sessions.get(sessionId);
    if (previousState?.pendingExit) {
      this.drainPendingExitSynchronously(sessionId, previousState);
    }
    this.cleanupLiveState(sessionId, { deleteState: true, deleteBuffer: true });
    const registration = this.consumeRegistrationIntent(sessionId, options?.registrationEpoch);

    const generation = (this.generationCounters.get(sessionId) ?? 0) + 1;
    this.generationCounters.set(sessionId, generation);
    const state: SessionState = {
      pty,
      generation,
      registrationEpoch: registration.epoch,
      ringBuffer: new Utf8RingBuffer(this.ringBufferCapBytes),
      live: true,
      sequence: 0,
      pendingData: [],
      pendingDataHead: 0,
      pendingByteLength: 0,
      flushTimer: null,
      inputOff: null,
      inflightBatches: [],
      inflightByteLength: 0,
      paused: false,
      resumeRetryTimer: null,
      resumeRetryAttempt: 0,
      pendingExit: null,
    };
    this.sessions.set(sessionId, state);
    for (const consumer of this.consumers.get(sessionId)?.values() ?? []) {
      consumer.generation = generation;
      consumer.acknowledgedSequence = 0;
    }

    pty.onData((data) => {
      if (this.sessions.get(sessionId) !== state) return;
      const encoded = Buffer.from(data, 'utf8');
      if (encoded.length === 0) return;
      state.pendingData.push(encoded);
      state.pendingByteLength += encoded.length;
      state.ringBuffer.append(data, encoded.length);
      if (state.flushTimer !== null && state.pendingByteLength >= PTY_OUTPUT_BATCH_MAX_BYTES) {
        clearTimeout(state.flushTimer);
        state.flushTimer = null;
      }
      let immediateBatchCount = 0;
      while (
        state.pendingByteLength >= PTY_OUTPUT_BATCH_MAX_BYTES &&
        !state.paused &&
        immediateBatchCount < PTY_IMMEDIATE_FLUSH_MAX_BATCHES &&
        this.flushOne(sessionId, state)
      ) {
        immediateBatchCount += 1;
      }
      if (this.finalizeExitIfDrained(sessionId, state)) return;
      this.scheduleFlush(
        sessionId,
        state,
        state.pendingByteLength >= PTY_OUTPUT_BATCH_MAX_BYTES ? 0 : FLUSH_INTERVAL_MS
      );
    });

    pty.onExit((info) => {
      if (this.sessions.get(sessionId) !== state || state.pendingExit) return;
      state.live = false;
      state.inputOff?.();
      state.inputOff = null;
      state.pendingExit = { info, preserveBuffer: preserveBufferOnExit };
      // The producer is gone, so transport backpressure no longer protects
      // anything. Drain the finite tail in fairness-bounded IPC batches without
      // waiting for renderer ACKs or calling resume on an exited PTY.
      this.clearResumeRetry(state);
      state.paused = false;
      state.inflightBatches = [];
      state.inflightByteLength = 0;
      if (state.flushTimer !== null) {
        clearTimeout(state.flushTimer);
        state.flushTimer = null;
      }
      if (state.pendingByteLength > 0) {
        this.flushOne(sessionId, state);
      }
      if (!this.finalizeExitIfDrained(sessionId, state)) {
        this.scheduleFlush(sessionId, state, 0);
      }
    });

    state.inputOff = events.on(
      ptyInputChannel,
      (data) => {
        if (this.sessions.get(sessionId) === state) pty.write(data);
      },
      sessionId
    );
    if (registration.acceptPendingInput) {
      this.drainPendingInput(sessionId, pty, registration.epoch);
    } else {
      this.clearPendingInput(sessionId);
    }
  }

  unregister(sessionId: string): void {
    const intent = this.registrationIntents.get(sessionId);
    if (intent) this.clearRegistrationIntent(sessionId, intent);
    this.clearPendingInput(sessionId);
    this.cleanupLiveState(sessionId, { deleteState: true, deleteBuffer: true });
  }

  get(sessionId: string): Pty | undefined {
    const state = this.sessions.get(sessionId);
    return state?.live ? state.pty : undefined;
  }

  /**
   * Preserve ordered input during the short renderer-ready/backend-register
   * window. This is especially important for optimistic terminal creation and
   * conversation resume, where a fast keypress previously hit `not_found` and
   * disappeared.
   */
  writeOrQueue(sessionId: string, data: string): 'written' | 'queued' | 'full' | 'unavailable' {
    const pty = this.get(sessionId);
    if (pty) {
      if (data) pty.write(data);
      return 'written';
    }

    const intent = this.registrationIntents.get(sessionId);
    if (!intent || intent.expiresAt <= Date.now()) {
      if (intent) this.clearRegistrationIntent(sessionId, intent);
      this.clearPendingInput(sessionId);
      return 'unavailable';
    }
    if (!data) return 'queued';
    const byteLength = Buffer.byteLength(data, 'utf8');
    let current = this.pendingInputs.get(sessionId);
    if (current && current.epoch !== intent.epoch) {
      this.clearPendingInput(sessionId);
      current = undefined;
    }
    if ((current?.byteLength ?? 0) + byteLength > PTY_PENDING_INPUT_CAP_BYTES) {
      return 'full';
    }

    if (current) {
      if (current.chunks.length >= PTY_PENDING_INPUT_MAX_CHUNKS) {
        current.chunks = [current.chunks.join('') + data];
      } else {
        current.chunks.push(data);
      }
      current.byteLength += byteLength;
    } else {
      if (this.pendingInputs.size >= PTY_PENDING_INPUT_MAX_SESSIONS) return 'full';
      const pending: PendingInput = {
        epoch: intent.epoch,
        chunks: [data],
        byteLength,
        expiresAt: Date.now() + PTY_PENDING_INPUT_TTL_MS,
        timer: null,
      };
      pending.timer = this.createPendingInputTimer(sessionId, pending);
      this.pendingInputs.set(sessionId, pending);
    }
    return 'queued';
  }

  snapshot(sessionId: string): string {
    return this.sessions.get(sessionId)?.ringBuffer.snapshot() ?? '';
  }

  /**
   * Flush first, then snapshot a sequence watermark and activate flow control.
   * A renderer installs its event listener before this call and ignores queued
   * events at or below the returned watermark, closing both the loss and
   * duplicate windows at the snapshot/live boundary.
   */
  subscribe(sessionId: string, consumerId: string): PtySubscriptionSnapshot {
    const state = this.sessions.get(sessionId);
    const currentGeneration = state?.generation ?? this.generationCounters.get(sessionId) ?? 0;
    if (state && !state.paused && state.pendingByteLength > 0) {
      if (state.flushTimer !== null) {
        clearTimeout(state.flushTimer);
        state.flushTimer = null;
      }
      this.flushOne(sessionId, state);
    }

    const consumers = this.consumers.get(sessionId) ?? new Map<string, ConsumerState>();
    consumers.set(consumerId, {
      generation: currentGeneration,
      acknowledgedSequence: 0,
      expiresAt: Date.now() + PTY_CONSUMER_LEASE_TIMEOUT_MS,
    });
    this.consumers.set(sessionId, consumers);
    this.scheduleConsumerLeaseSweep();

    if (!state) return { buffer: '', generation: currentGeneration, sequence: 0 };
    const snapshot = {
      buffer: this.snapshotCommittedOutput(state),
      generation: state.generation,
      sequence: state.sequence,
    };
    if (!this.finalizeExitIfDrained(sessionId, state)) {
      this.scheduleFlush(
        sessionId,
        state,
        state.pendingByteLength >= PTY_OUTPUT_BATCH_MAX_BYTES ? 0 : FLUSH_INTERVAL_MS
      );
    }
    return snapshot;
  }

  acknowledge(sessionId: string, consumerId: string, generation: number, sequence: number): void {
    if (!isValidPtyWatermark(generation) || !isValidPtyWatermark(sequence)) return;
    const state = this.sessions.get(sessionId);
    if (!state || state.generation !== generation) return;
    const consumer = this.consumers.get(sessionId)?.get(consumerId);
    if (!consumer || consumer.generation !== generation) return;

    consumer.acknowledgedSequence = Math.max(
      consumer.acknowledgedSequence,
      Math.min(sequence, state.sequence)
    );
    consumer.expiresAt = Date.now() + PTY_CONSUMER_LEASE_TIMEOUT_MS;
    this.pruneAcknowledgedBatches(sessionId, state);
    this.scheduleConsumerLeaseSweep();
  }

  heartbeat(
    sessionId: string,
    consumerId: string,
    generation: number,
    acknowledgedSequence: number
  ): void {
    if (!isValidPtyWatermark(generation) || !isValidPtyWatermark(acknowledgedSequence)) return;
    const state = this.sessions.get(sessionId);
    const consumers = this.consumers.get(sessionId);
    const current = consumers?.get(consumerId);
    if (!consumers || !current) return;
    const currentGeneration = state?.generation ?? current.generation;
    const nextAcknowledgedSequence =
      currentGeneration === generation
        ? Math.max(
            current?.generation === generation ? current.acknowledgedSequence : 0,
            Math.min(acknowledgedSequence, state?.sequence ?? acknowledgedSequence)
          )
        : 0;
    consumers.set(consumerId, {
      generation: currentGeneration,
      acknowledgedSequence: nextAcknowledgedSequence,
      expiresAt: Date.now() + PTY_CONSUMER_LEASE_TIMEOUT_MS,
    });
    if (state) this.pruneAcknowledgedBatches(sessionId, state);
    this.scheduleConsumerLeaseSweep();
  }

  unsubscribe(sessionId: string, consumerId: string): void {
    const consumers = this.consumers.get(sessionId);
    if (!consumers?.delete(consumerId)) return;
    if (consumers.size === 0) {
      this.consumers.delete(sessionId);
    }
    const state = this.sessions.get(sessionId);
    if (state) this.pruneAcknowledgedBatches(sessionId, state);
    this.scheduleConsumerLeaseSweep();
  }

  private scheduleFlush(sessionId: string, state: SessionState, delay: number): void {
    if (state.flushTimer !== null || state.paused || state.pendingByteLength === 0) return;
    state.flushTimer = setTimeout(() => {
      state.flushTimer = null;
      const hasMore = this.flushOne(sessionId, state);
      if (this.finalizeExitIfDrained(sessionId, state)) return;
      if (hasMore) this.scheduleFlush(sessionId, state, 0);
    }, delay);
  }

  /** Emit one fairness-bounded batch. Returns true while more output remains. */
  private flushOne(sessionId: string, state: SessionState): boolean {
    if (this.sessions.get(sessionId) !== state || state.pendingByteLength === 0) return false;

    const tracksConsumerBacklog =
      !state.pendingExit && this.hasCurrentConsumers(sessionId, state.generation);
    const remainingFlowControlBudget = tracksConsumerBacklog
      ? PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES - state.inflightByteLength
      : PTY_OUTPUT_BATCH_MAX_BYTES;
    if (remainingFlowControlBudget <= 0) {
      this.setPaused(sessionId, state, true);
      return false;
    }

    const { data, byteLength } = takePendingUtf8Batch(
      state,
      Math.min(PTY_OUTPUT_BATCH_MAX_BYTES, remainingFlowControlBudget)
    );
    if (byteLength === 0) {
      // The remaining budget can be smaller than one UTF-8 code point. Pause a
      // few bytes early instead of splitting that character or overshooting.
      if (tracksConsumerBacklog) this.setPaused(sessionId, state, true);
      return false;
    }
    state.sequence += 1;

    const payload: PtyDataEvent = {
      generation: state.generation,
      sequence: state.sequence,
      byteLength,
      data,
    };
    events.emit(ptyDataChannel, payload, sessionId);

    if (tracksConsumerBacklog) {
      state.inflightBatches.push({ sequence: state.sequence, byteLength });
      state.inflightByteLength += byteLength;
      if (!state.paused && state.inflightByteLength >= PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES) {
        this.setPaused(sessionId, state, true);
      }
    }
    return state.pendingByteLength > 0;
  }

  private snapshotCommittedOutput(state: SessionState): string {
    const snapshot = state.ringBuffer.snapshot();
    if (state.pendingByteLength === 0) return snapshot;
    const bytes = Buffer.from(snapshot, 'utf8');
    if (state.pendingByteLength >= bytes.length) return '';
    return bytes.subarray(0, bytes.length - state.pendingByteLength).toString('utf8');
  }

  private finalizeExitIfDrained(sessionId: string, state: SessionState): boolean {
    if (state.pendingByteLength !== 0 || !state.pendingExit) return false;
    this.finalizeExit(sessionId, state);
    return true;
  }

  private finalizeExit(sessionId: string, state: SessionState): void {
    const pendingExit = state.pendingExit;
    if (!pendingExit || this.sessions.get(sessionId) !== state) return;
    state.pendingExit = null;
    events.emit(ptyExitChannel, pendingExit.info, sessionId);
    this.endRegistrationThroughEpoch(sessionId, state.registrationEpoch);
    if (pendingExit.preserveBuffer) {
      this.cleanupLiveState(sessionId, { deleteState: false, deleteBuffer: false });
    } else {
      this.cleanupLiveState(sessionId, { deleteState: true, deleteBuffer: true });
    }
  }

  /**
   * A same-id replacement must not erase the finite tail of a backend that has
   * already exited. This path is deliberately synchronous and exceptional:
   * emit every old-generation batch and its exit before the new generation is
   * made observable.
   */
  private drainPendingExitSynchronously(sessionId: string, state: SessionState): void {
    if (state.flushTimer !== null) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
    state.paused = false;
    while (state.pendingByteLength > 0 && this.flushOne(sessionId, state)) {
      // Drain the already-finite tail in fairness-bounded event payloads.
    }
    this.finalizeExitIfDrained(sessionId, state);
  }

  private pruneAcknowledgedBatches(sessionId: string, state: SessionState): void {
    const consumers = this.consumers.get(sessionId);
    let slowestAcknowledgedSequence = Number.POSITIVE_INFINITY;
    let currentConsumerCount = 0;
    for (const consumer of consumers?.values() ?? []) {
      if (consumer.generation !== state.generation) continue;
      currentConsumerCount += 1;
      slowestAcknowledgedSequence = Math.min(
        slowestAcknowledgedSequence,
        consumer.acknowledgedSequence
      );
    }

    if (currentConsumerCount === 0) {
      state.inflightBatches = [];
      state.inflightByteLength = 0;
    } else {
      while (
        state.inflightBatches.length > 0 &&
        state.inflightBatches[0].sequence <= slowestAcknowledgedSequence
      ) {
        const batch = state.inflightBatches.shift();
        if (batch) state.inflightByteLength -= batch.byteLength;
      }
      state.inflightByteLength = Math.max(0, state.inflightByteLength);
    }

    if (state.paused && state.inflightByteLength <= PTY_FLOW_CONTROL_LOW_WATERMARK_BYTES) {
      this.setPaused(sessionId, state, false);
      this.scheduleFlush(sessionId, state, 0);
    }
  }

  private hasCurrentConsumers(sessionId: string, generation: number): boolean {
    for (const consumer of this.consumers.get(sessionId)?.values() ?? []) {
      if (consumer.generation === generation) return true;
    }
    return false;
  }

  private setPaused(sessionId: string, state: SessionState, paused: boolean): void {
    if (state.paused === paused) return;
    // Once the backend has exited there is no producer left to resume. The
    // remaining work is only draining already-buffered output to renderers, so
    // do not let a closed PTY's resume implementation block that drain.
    if (!paused && !state.live) {
      state.paused = false;
      return;
    }
    const method = paused ? state.pty.pause : state.pty.resume;
    if (!method) {
      state.paused = paused;
      return;
    }
    try {
      method.call(state.pty);
      state.paused = paused;
      if (!paused) this.clearResumeRetry(state);
    } catch (error) {
      // Even when the transport cannot be paused, keep renderer delivery
      // bounded in main-process memory. A failed live resume stays paused so a
      // later ACK/heartbeat can retry it.
      if (paused) {
        state.paused = true;
      } else {
        this.scheduleResumeRetry(sessionId, state);
      }
      log.warn('PtySessionRegistry: failed to change PTY flow-control state', {
        sessionId,
        paused,
        error: String(error),
      });
    }
  }

  private scheduleResumeRetry(sessionId: string, state: SessionState): void {
    if (state.resumeRetryTimer !== null || !state.live || !state.paused) {
      return;
    }

    const delay = Math.min(
      PTY_RESUME_RETRY_BASE_MS * 2 ** state.resumeRetryAttempt,
      PTY_RESUME_RETRY_MAX_DELAY_MS
    );
    state.resumeRetryAttempt = Math.min(state.resumeRetryAttempt + 1, 31);
    state.resumeRetryTimer = setTimeout(() => {
      state.resumeRetryTimer = null;
      if (this.sessions.get(sessionId) !== state || !state.live || !state.paused) return;
      this.setPaused(sessionId, state, false);
      if (!state.paused) this.scheduleFlush(sessionId, state, 0);
    }, delay);
    (
      state.resumeRetryTimer as ReturnType<typeof setTimeout> & {
        unref?: () => void;
      }
    ).unref?.();
  }

  private clearResumeRetry(state: SessionState): void {
    if (state.resumeRetryTimer !== null) {
      clearTimeout(state.resumeRetryTimer);
      state.resumeRetryTimer = null;
    }
    state.resumeRetryAttempt = 0;
  }

  private createPendingInputTimer(
    sessionId: string,
    pending: PendingInput
  ): ReturnType<typeof setTimeout> {
    return setTimeout(
      () => {
        if (this.pendingInputs.get(sessionId) === pending && Date.now() >= pending.expiresAt) {
          this.pendingInputs.delete(sessionId);
        }
      },
      Math.max(0, pending.expiresAt - Date.now())
    );
  }

  private clearPendingInput(sessionId: string): void {
    const pending = this.pendingInputs.get(sessionId);
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    this.pendingInputs.delete(sessionId);
  }

  private drainPendingInput(sessionId: string, pty: Pty, registrationEpoch: number): void {
    const pending = this.pendingInputs.get(sessionId);
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    this.pendingInputs.delete(sessionId);
    if (pending.epoch !== registrationEpoch || Date.now() >= pending.expiresAt) return;
    for (const chunk of pending.chunks) pty.write(chunk);
  }

  private consumeRegistrationIntent(
    sessionId: string,
    requestedEpoch: number | undefined
  ): { epoch: number; acceptPendingInput: boolean } {
    const intent = this.registrationIntents.get(sessionId);
    const accepted =
      intent !== undefined &&
      intent.expiresAt > Date.now() &&
      (requestedEpoch === undefined || requestedEpoch === intent.epoch);
    const epoch =
      requestedEpoch ?? intent?.epoch ?? (this.registrationEpochCounters.get(sessionId) ?? 0) + 1;
    this.registrationEpochCounters.set(
      sessionId,
      Math.max(this.registrationEpochCounters.get(sessionId) ?? 0, epoch)
    );
    if (accepted && intent) this.clearRegistrationIntent(sessionId, intent);
    return { epoch, acceptPendingInput: accepted };
  }

  private clearRegistrationIntent(sessionId: string, intent: RegistrationIntent): void {
    if (this.registrationIntents.get(sessionId) !== intent) return;
    clearTimeout(intent.timer);
    this.registrationIntents.delete(sessionId);
  }

  private endRegistrationThroughEpoch(sessionId: string, epoch: number): void {
    const intent = this.registrationIntents.get(sessionId);
    if (intent && intent.epoch > epoch) return;
    if (intent) this.clearRegistrationIntent(sessionId, intent);
    this.clearPendingInput(sessionId);
  }

  private scheduleConsumerLeaseSweep(): void {
    // Renewals only move an existing lease later. Keep the already scheduled
    // earliest sweep instead of rebuilding it (and scanning every consumer)
    // for every 64 KiB ACK/heartbeat. An early wake simply recomputes the next
    // expiry, which makes the hot ACK path O(1).
    if (this.consumerLeaseTimer !== null) return;

    let nextExpiry = Number.POSITIVE_INFINITY;
    for (const consumers of this.consumers.values()) {
      for (const consumer of consumers.values()) {
        nextExpiry = Math.min(nextExpiry, consumer.expiresAt);
      }
    }
    if (!Number.isFinite(nextExpiry)) return;

    this.consumerLeaseTimer = setTimeout(
      () => {
        this.consumerLeaseTimer = null;
        this.expireConsumerLeases();
      },
      Math.max(0, nextExpiry - Date.now())
    );
    (
      this.consumerLeaseTimer as ReturnType<typeof setTimeout> & {
        unref?: () => void;
      }
    ).unref?.();
  }

  private expireConsumerLeases(): void {
    const now = Date.now();
    const changedSessions = new Set<string>();
    for (const [sessionId, consumers] of this.consumers) {
      for (const [consumerId, consumer] of consumers) {
        if (consumer.expiresAt <= now) {
          consumers.delete(consumerId);
          changedSessions.add(sessionId);
        }
      }
      if (consumers.size === 0) this.consumers.delete(sessionId);
    }
    for (const sessionId of changedSessions) {
      const state = this.sessions.get(sessionId);
      if (state) this.pruneAcknowledgedBatches(sessionId, state);
    }
    this.scheduleConsumerLeaseSweep();
  }

  private cleanupLiveState(
    sessionId: string,
    options: { deleteState: boolean; deleteBuffer: boolean }
  ): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    if (state.flushTimer !== null) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
    state.pendingData = [];
    state.pendingDataHead = 0;
    state.pendingByteLength = 0;
    state.inputOff?.();
    state.inputOff = null;
    state.inflightBatches = [];
    state.inflightByteLength = 0;
    state.pendingExit = null;
    this.setPaused(sessionId, state, false);
    this.clearResumeRetry(state);

    if (options.deleteBuffer) state.ringBuffer.clear();
    if (options.deleteState) {
      this.sessions.delete(sessionId);
    }
  }
}

export const ptySessionRegistry = new PtySessionRegistry();
