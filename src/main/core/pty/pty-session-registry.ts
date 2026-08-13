import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import {
  ptyDataChannel,
  ptyExitChannel,
  ptyInputChannel,
  type PtyDataEvent,
} from '@shared/events/ptyEvents';
import {
  PTY_RENDER_CHECKPOINT_MAX_BYTES,
  PTY_RENDER_CHECKPOINT_SCROLLBACK_LINES,
  type PtyRenderCheckpoint,
  type PtyRenderCheckpointDimensions,
} from '@shared/pty-render-checkpoint';
import {
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  getTerminalRingBufferCapBytes,
} from '@shared/terminal-settings';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import type { Pty, PtyExitInfo } from './pty';
import { PtyRenderCheckpointTracker } from './pty-render-checkpoint';
import { TmuxTerminalReplyFilter } from './tmux-terminal-reply-filter';

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
/** Bound a generation reveal across route commit and the browser's painted-frame ACK. */
export const PTY_GENERATION_REVEAL_CLAIM_TIMEOUT_MS = 6_000;
/**
 * Keep the attached tmux client around briefly so a rapid LRU bounce can reuse
 * the renderer-authored checkpoint without paying for another tmux attach.
 */
export const PTY_RENDERER_DETACH_GRACE_MS = 1_000;
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
  ownerWebContentsId: number | null;
};

type SessionState = {
  readonly pty: Pty;
  readonly generation: number;
  readonly registrationEpoch: number;
  readonly ringBuffer: Utf8RingBuffer;
  readonly tmuxInputFilter: TmuxTerminalReplyFilter | null;
  readonly tmuxBacked: boolean;
  readonly onRendererIdle: ((generation: number) => void) | undefined;
  renderCheckpoint: PtyRenderCheckpointTracker | null;
  rendererDetachTimer: ReturnType<typeof setTimeout> | null;
  live: boolean;
  sequence: number;
  pendingData: Buffer[];
  pendingDataHead: number;
  pendingByteLength: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
  inputOff: (() => void) | null;
  inflightBatches: InflightBatch[];
  inflightByteLength: number;
  rendererBackpressured: boolean;
  checkpointBackpressured: boolean;
  paused: boolean;
  resumeRetryTimer: ReturnType<typeof setTimeout> | null;
  resumeRetryAttempt: number;
  pendingExit: { info: PtyExitInfo; preserveBuffer: boolean } | null;
  readonly onFinalExit: ((info: PtyExitInfo, generation: number) => void) | undefined;
  outputBytesTotal: number;
  outputRateSampleAt: number;
  outputRateSampleBytes: number;
  outputBytesPerSecond: number;
  lastOutputAt: number | null;
  lastInputAt: number | null;
};

export type PtySubscriptionSnapshot = {
  buffer: string;
  generation: number;
  sequence: number;
  /** The buffer came from transcript history and must be replaced by a live generation. */
  replayedFromHistory?: boolean;
  /** Original grid for a compact serialized framebuffer. */
  checkpointDimensions?: PtyRenderCheckpointDimensions;
  /** Whether a compact checkpoint is safe to reveal without a stability heuristic. */
  checkpointCanonical?: boolean;
};

export type PtySessionDiagnostics = {
  sessionId: string;
  live: boolean;
  /** A create/resume operation owns a registration epoch but has not registered yet. */
  registering?: boolean;
  outputBytesPerSecond: number;
  lastOutputAt: number | null;
  lastInputAt: number | null;
  ringBufferBytes: number;
  ringBufferCapBytes: number;
  consumerCount: number;
  pendingOutputBytes: number;
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

type GenerationRevealClaim = {
  token: string;
  sessionId: string;
  consumerId: string;
  generation: number;
  ownerWebContentsId: number;
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

  get sizeBytes(): number {
    return this.byteLength;
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
  private readonly revealClaims = new Map<string, GenerationRevealClaim>();
  private readonly revealClaimTokensBySession = new Map<string, Set<string>>();
  private readonly revealClaimWaiters = new Map<string, Set<() => void>>();
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

  /**
   * Whether an operation still owns either the pending registration intent or
   * the live PTY that consumed that exact epoch. Startup hydration can register
   * while an explicit resume waits on its barrier, so intent-only checks would
   * reject the successful same-owner handoff.
   */
  ownsRegistration(sessionId: string, epoch: number): boolean {
    const intent = this.registrationIntents.get(sessionId);
    if (intent && intent.expiresAt > Date.now()) return intent.epoch === epoch;
    const state = this.sessions.get(sessionId);
    return state?.live === true && state.registrationEpoch === epoch;
  }

  /**
   * Atomically reserve the exact backend generation while a renderer crosses
   * route commit and browser paint. A registration intent and a reveal claim
   * cannot overtake one another in the single main-process turn: intent-first
   * denies the claim; claim-first makes the provider wait before spawning.
   */
  claimGenerationReveal(
    sessionId: string,
    consumerId: string,
    expectedGeneration: number,
    ownerWebContentsId: number
  ): { token: string; generation: number; expiresAt: number } | null {
    const state = this.sessions.get(sessionId);
    const consumer = this.consumers.get(sessionId)?.get(consumerId);
    const registration = this.registrationIntents.get(sessionId);
    if (
      !state?.live ||
      state.generation !== expectedGeneration ||
      (registration !== undefined && registration.expiresAt > Date.now()) ||
      !consumer ||
      consumer.generation !== expectedGeneration ||
      consumer.ownerWebContentsId !== ownerWebContentsId
    ) {
      return null;
    }

    const token = randomUUID();
    const expiresAt = Date.now() + PTY_GENERATION_REVEAL_CLAIM_TIMEOUT_MS;
    const claim = {
      token,
      sessionId,
      consumerId,
      generation: expectedGeneration,
      ownerWebContentsId,
      expiresAt,
      timer: setTimeout(
        () => this.releaseGenerationReveal(token, ownerWebContentsId),
        PTY_GENERATION_REVEAL_CLAIM_TIMEOUT_MS
      ),
    } satisfies GenerationRevealClaim;
    claim.timer.unref?.();
    this.revealClaims.set(token, claim);
    const tokens = this.revealClaimTokensBySession.get(sessionId) ?? new Set<string>();
    tokens.add(token);
    this.revealClaimTokensBySession.set(sessionId, tokens);
    return { token, generation: expectedGeneration, expiresAt };
  }

  /** Owner-bound and idempotent; renderer reload cleanup uses the same path. */
  releaseGenerationReveal(token: string, ownerWebContentsId: number): boolean {
    const claim = this.revealClaims.get(token);
    if (!claim || claim.ownerWebContentsId !== ownerWebContentsId) return false;
    this.releaseGenerationRevealClaim(claim);
    return true;
  }

  /**
   * Providers call this immediately before opening the replacement PTY. The
   * registration intent already blocks new claims, so once this resolves true
   * no later reveal can slip ahead of this epoch's spawn.
   */
  async waitForRevealClaims(sessionId: string, registrationEpoch: number): Promise<boolean> {
    while (this.hasGenerationRevealClaims(sessionId)) {
      if (!this.isRegistrationCurrent(sessionId, registrationEpoch)) return false;
      await new Promise<void>((resolve) => {
        const waiters = this.revealClaimWaiters.get(sessionId) ?? new Set<() => void>();
        waiters.add(resolve);
        this.revealClaimWaiters.set(sessionId, waiters);
        // Close release-between-check-and-listener without polling.
        if (!this.hasGenerationRevealClaims(sessionId)) {
          waiters.delete(resolve);
          resolve();
        }
      });
    }
    return this.isRegistrationCurrent(sessionId, registrationEpoch);
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
    options?: {
      onFinalExit?: (info: PtyExitInfo, generation: number) => void;
      preserveBufferOnExit?: boolean;
      registrationEpoch?: number;
      tmuxBacked?: boolean;
      onRendererIdle?: (generation: number) => void;
    }
  ): void {
    if (this.hasGenerationRevealClaims(sessionId)) {
      throw new Error(`Cannot replace PTY ${sessionId} while its generation reveal is claimed`);
    }
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
      tmuxInputFilter: options?.tmuxBacked ? new TmuxTerminalReplyFilter() : null,
      tmuxBacked: options?.tmuxBacked === true,
      onRendererIdle: options?.onRendererIdle,
      renderCheckpoint: null,
      rendererDetachTimer: null,
      live: true,
      sequence: 0,
      pendingData: [],
      pendingDataHead: 0,
      pendingByteLength: 0,
      flushTimer: null,
      inputOff: null,
      inflightBatches: [],
      inflightByteLength: 0,
      rendererBackpressured: false,
      checkpointBackpressured: false,
      paused: false,
      resumeRetryTimer: null,
      resumeRetryAttempt: 0,
      pendingExit: null,
      onFinalExit: options?.onFinalExit,
      outputBytesTotal: 0,
      outputRateSampleAt: Date.now(),
      outputRateSampleBytes: 0,
      outputBytesPerSecond: 0,
      lastOutputAt: null,
      lastInputAt: null,
    };
    this.sessions.set(sessionId, state);
    for (const consumer of this.consumers.get(sessionId)?.values() ?? []) {
      consumer.generation = generation;
      consumer.acknowledgedSequence = 0;
    }
    // Invalidate an attached renderer's previous generation before the new
    // backend has produced its first visible byte. This sentinel carries no
    // output/backlog cost and is intentionally excluded from inflight flow
    // control; the first real batch still starts at sequence 1.
    if (this.hasCurrentConsumers(sessionId, generation)) {
      events.emit(ptyDataChannel, { generation, sequence: 0, byteLength: 0, data: '' }, sessionId);
    }

    pty.onData((data) => {
      if (this.sessions.get(sessionId) !== state) return;
      const encoded = Buffer.from(data, 'utf8');
      if (encoded.length === 0) return;
      state.pendingData.push(encoded);
      state.pendingByteLength += encoded.length;
      state.outputBytesTotal += encoded.length;
      state.lastOutputAt = Date.now();
      state.ringBuffer.append(data, encoded.length);
      if (state.renderCheckpoint && !this.hasCurrentConsumers(sessionId, state.generation)) {
        // With no live renderer, the checkpoint becomes the sole owner of raw
        // output at the current watermark. While a renderer exists, bytes must
        // first receive a sequence in flushOne before the tracker can parse them.
        this.transferPendingOutputToCheckpoint(state);
      }
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
      this.releaseGenerationRevealClaimsForSession(sessionId);
      state.live = false;
      state.inputOff?.();
      state.inputOff = null;
      state.pendingExit = { info, preserveBuffer: preserveBufferOnExit };
      // The producer is gone, so transport backpressure no longer protects
      // anything. Drain a consumed session's finite tail in fairness-bounded IPC
      // batches; a cold tail is already complete in the replay ring.
      this.clearResumeRetry(state);
      state.rendererBackpressured = false;
      state.checkpointBackpressured = false;
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
      const shouldDeferColdFinalization =
        !preserveBufferOnExit &&
        !this.hasCurrentConsumers(sessionId, state.generation) &&
        state.ringBuffer.sizeBytes > 0 &&
        state.pendingByteLength === 0;
      if (shouldDeferColdFinalization) {
        // Keep the replay ring alive through the current tick. A renderer that
        // installed its listener immediately before subscribe can still take
        // the final snapshot; without a subscriber, the zero-delay task cleans
        // up the non-persistent session promptly.
        this.scheduleFinalExit(sessionId, state);
        return;
      }
      if (!this.finalizeExitIfDrained(sessionId, state)) {
        this.scheduleFlush(sessionId, state, 0);
      }
    });

    state.inputOff = events.on(
      ptyInputChannel,
      (data) => {
        if (this.sessions.get(sessionId) === state) {
          this.cancelRendererDetach(state);
          this.writeInput(state, data);
        }
      },
      sessionId
    );
    if (registration.acceptPendingInput) {
      this.drainPendingInput(sessionId, state, registration.epoch);
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

  /**
   * Release exactly one renderer-idle tmux transport without publishing a PTY
   * or agent exit. The caller owns the provider-side identity and kills only
   * the already-validated attach wrapper after this synchronous handoff.
   */
  detachRendererTransport(
    sessionId: string,
    expectedGeneration: number,
    expectedPty: Pty
  ): boolean {
    const state = this.sessions.get(sessionId);
    if (
      !state?.live ||
      !state.tmuxBacked ||
      state.pty !== expectedPty ||
      state.generation !== expectedGeneration ||
      !state.renderCheckpoint ||
      this.hasCurrentConsumers(sessionId, expectedGeneration)
    ) {
      return false;
    }

    // This is an intentional transport detach, not a producer exit. Mark it
    // offline before shared cleanup so a paused PTY is not resumed immediately
    // before its tmux attach wrapper is killed.
    state.live = false;
    this.cleanupLiveState(sessionId, { deleteState: true, deleteBuffer: true });
    return true;
  }

  get(sessionId: string): Pty | undefined {
    const state = this.sessions.get(sessionId);
    return state?.live ? state.pty : undefined;
  }

  /**
   * Resize exactly the renderer-owned PTY generation. The generation check,
   * backend resize, and checkpoint update are synchronous so a stale renderer
   * cannot mutate a replacement session's terminal grid.
   */
  resizeForRenderer(
    sessionId: string,
    expectedGeneration: number,
    cols: number,
    rows: number
  ): { generation: number; changed: boolean } | null {
    const state = this.sessions.get(sessionId);
    const registration = this.registrationIntents.get(sessionId);
    if (
      !state?.live ||
      (registration !== undefined && registration.expiresAt > Date.now()) ||
      state.generation !== expectedGeneration ||
      !Number.isSafeInteger(cols) ||
      cols < 2 ||
      !Number.isSafeInteger(rows) ||
      rows < 1
    ) {
      return null;
    }

    const resized = state.pty.resize(cols, rows);
    if (
      resized === false ||
      this.sessions.get(sessionId) !== state ||
      !state.live ||
      state.generation !== expectedGeneration
    ) {
      return null;
    }

    state.renderCheckpoint?.resize(cols, rows);
    return { generation: state.generation, changed: true };
  }

  /**
   * Preserve ordered input during the short renderer-ready/backend-register
   * window. This is especially important for optimistic terminal creation and
   * conversation resume, where a fast keypress previously hit `not_found` and
   * disappeared.
   */
  writeOrQueue(sessionId: string, data: string): 'written' | 'queued' | 'full' | 'unavailable' {
    const state = this.sessions.get(sessionId);
    if (state?.live) {
      this.cancelRendererDetach(state);
      this.writeInput(state, data);
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

  /** Current backend generation, including the last generation after exit. */
  getGeneration(sessionId: string): number {
    return this.sessions.get(sessionId)?.generation ?? this.generationCounters.get(sessionId) ?? 0;
  }

  getDiagnostics(sessionId: string): PtySessionDiagnostics | null {
    const state = this.sessions.get(sessionId);
    const consumerCount = this.consumers.get(sessionId)?.size ?? 0;
    const intent = this.registrationIntents.get(sessionId);
    const registering = intent !== undefined && intent.expiresAt > Date.now();
    if (!state && !registering && consumerCount === 0) return null;
    const now = Date.now();
    const elapsedMs = state ? now - state.outputRateSampleAt : 0;
    if (state && elapsedMs >= 250) {
      state.outputBytesPerSecond =
        ((state.outputBytesTotal - state.outputRateSampleBytes) * 1_000) / elapsedMs;
      state.outputRateSampleAt = now;
      state.outputRateSampleBytes = state.outputBytesTotal;
    }
    return {
      sessionId,
      live: state?.live ?? false,
      registering,
      outputBytesPerSecond: Math.round(state?.outputBytesPerSecond ?? 0),
      lastOutputAt: state?.lastOutputAt ?? null,
      lastInputAt: state?.lastInputAt ?? null,
      ringBufferBytes: state?.ringBuffer.sizeBytes ?? 0,
      ringBufferCapBytes: this.ringBufferCapBytes,
      consumerCount,
      pendingOutputBytes: state ? state.pendingByteLength + state.inflightByteLength : 0,
    };
  }

  /**
   * Flush first, then snapshot a sequence watermark and activate flow control.
   * A renderer installs its event listener before this call and ignores queued
   * events at or below the returned watermark, closing both the loss and
   * duplicate windows at the snapshot/live boundary.
   */
  subscribe(
    sessionId: string,
    consumerId: string,
    options?: { materializeBuffer?: boolean; ownerWebContentsId?: number | null }
  ): PtySubscriptionSnapshot {
    const state = this.sessions.get(sessionId);
    if (state) this.cancelRendererDetach(state);
    const currentGeneration = state?.generation ?? this.generationCounters.get(sessionId) ?? 0;
    if (state?.renderCheckpoint && !this.hasCurrentConsumers(sessionId, state.generation)) {
      // Close the last-consumer/raw-output boundary before choosing the compact
      // snapshot watermark. These bytes will not also enter the live stream.
      this.transferPendingOutputToCheckpoint(state);
    }
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
      ownerWebContentsId: options?.ownerWebContentsId ?? null,
    });
    this.consumers.set(sessionId, consumers);
    this.scheduleConsumerLeaseSweep();

    if (!state) return { buffer: '', generation: currentGeneration, sequence: 0 };
    const snapshot = {
      buffer: options?.materializeBuffer === false ? '' : this.snapshotCommittedOutput(state),
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

  /**
   * Prefer the compact framebuffer maintained after a renderer eviction. The
   * ordinary subscribe still establishes the consumer and snapshot/live
   * watermark first; the tracker marker then captures exactly that sequence.
   */
  async subscribeForRenderer(
    sessionId: string,
    consumerId: string,
    ownerWebContentsId: number | null = null
  ): Promise<PtySubscriptionSnapshot> {
    const initialState = this.sessions.get(sessionId);
    const initialTracker = initialState?.renderCheckpoint ?? null;
    // The tracker contains either exact numbered batches or raw bytes whose
    // ownership was transferred after the final consumer left. It can therefore
    // provide a compact snapshot even if another renderer has since subscribed.
    const checkpointAvailable = Boolean(initialTracker);
    const subscribeWithOwner = (materializeBuffer: boolean) =>
      this.subscribe(sessionId, consumerId, {
        materializeBuffer,
        ownerWebContentsId,
      });
    const subscription = subscribeWithOwner(!checkpointAvailable);
    const state = this.sessions.get(sessionId);
    const tracker = state?.renderCheckpoint;
    if (!state || !tracker || state.generation !== subscription.generation) {
      return checkpointAvailable ? subscribeWithOwner(true) : subscription;
    }

    try {
      const compactSnapshot = await tracker.snapshot();
      if (
        this.sessions.get(sessionId) !== state ||
        state.renderCheckpoint !== tracker ||
        compactSnapshot.generation !== state.generation ||
        compactSnapshot.sequence !== subscription.sequence
      ) {
        this.releaseRenderCheckpoint(sessionId, state, tracker);
        return subscribeWithOwner(true);
      }
      this.releaseRenderCheckpoint(sessionId, state, tracker);
      return {
        buffer: compactSnapshot.buffer,
        generation: compactSnapshot.generation,
        sequence: compactSnapshot.sequence,
        checkpointCanonical: compactSnapshot.canonical,
        checkpointDimensions: {
          cols: compactSnapshot.cols,
          rows: compactSnapshot.rows,
        },
      };
    } catch (error) {
      this.releaseRenderCheckpoint(sessionId, state, tracker);
      log.debug('[pty-checkpoint] compact snapshot unavailable', {
        sessionId,
        error: String(error),
      });
      return subscribeWithOwner(true);
    }
  }

  /** Seed a headless current-frame tracker before the frontend xterm is evicted. */
  saveRenderCheckpoint(sessionId: string, checkpoint: PtyRenderCheckpoint): boolean {
    const state = this.sessions.get(sessionId);
    if (
      !state ||
      typeof checkpoint.buffer !== 'string' ||
      !isValidPtyWatermark(checkpoint.generation) ||
      !isValidPtyWatermark(checkpoint.sequence) ||
      checkpoint.generation !== state.generation ||
      checkpoint.sequence > state.sequence ||
      !Number.isSafeInteger(checkpoint.cols) ||
      checkpoint.cols < 2 ||
      !Number.isSafeInteger(checkpoint.rows) ||
      checkpoint.rows < 1 ||
      typeof checkpoint.canonical !== 'boolean' ||
      !Number.isSafeInteger(checkpoint.scrollbackLines) ||
      checkpoint.scrollbackLines < 0 ||
      checkpoint.scrollbackLines > PTY_RENDER_CHECKPOINT_SCROLLBACK_LINES ||
      Buffer.byteLength(checkpoint.buffer, 'utf8') > PTY_RENDER_CHECKPOINT_MAX_BYTES
    ) {
      return false;
    }

    let catchup = '';
    if (checkpoint.sequence < state.sequence) {
      const batches = state.inflightBatches.filter(
        (batch) => batch.sequence > checkpoint.sequence && batch.sequence <= state.sequence
      );
      if (
        batches.length === 0 ||
        batches[0]?.sequence !== checkpoint.sequence + 1 ||
        batches.at(-1)?.sequence !== state.sequence ||
        batches.some((batch, index) => batch.sequence !== checkpoint.sequence + index + 1)
      ) {
        return false;
      }
      const catchupBytes = batches.reduce((total, batch) => total + batch.byteLength, 0);
      const committed = this.snapshotCommittedOutput(state);
      if (catchupBytes > Buffer.byteLength(committed, 'utf8')) return false;
      catchup = utf8Tail(committed, catchupBytes);
    }

    const previousTracker = state.renderCheckpoint;
    if (previousTracker) this.releaseRenderCheckpoint(sessionId, state, previousTracker);
    const tracker = new PtyRenderCheckpointTracker(checkpoint, {
      onBackpressureChange: (backpressured) => {
        if (this.sessions.get(sessionId) !== state || state.renderCheckpoint !== tracker) return;
        this.setCheckpointBackpressured(sessionId, state, backpressured);
      },
    });
    state.renderCheckpoint = tracker;
    if (catchup) tracker.write(catchup, state.sequence);
    return true;
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
      ownerWebContentsId: current.ownerWebContentsId,
    });
    if (state) this.pruneAcknowledgedBatches(sessionId, state);
    this.scheduleConsumerLeaseSweep();
  }

  unsubscribe(sessionId: string, consumerId: string): void {
    const consumers = this.consumers.get(sessionId);
    if (!consumers?.delete(consumerId)) return;
    this.releaseGenerationRevealClaimsForConsumer(sessionId, consumerId);
    if (consumers.size === 0) {
      this.consumers.delete(sessionId);
    }
    const state = this.sessions.get(sessionId);
    if (state) {
      if (!this.hasCurrentConsumers(sessionId, state.generation)) {
        // Transfer before pruning ACK state can resume the transport. The
        // checkpoint parser's independent pause reason remains in force if this
        // finite tail itself crosses its high-water mark.
        this.transferPendingOutputToCheckpoint(state);
      }
      this.pruneAcknowledgedBatches(sessionId, state);
    }
    this.scheduleConsumerLeaseSweep();
  }

  /** Release every consumer owned by a renderer that reloaded or crashed. */
  unsubscribeOwner(ownerWebContentsId: number): void {
    const owned: Array<{ sessionId: string; consumerId: string }> = [];
    for (const [sessionId, consumers] of this.consumers) {
      for (const [consumerId, consumer] of consumers) {
        if (consumer.ownerWebContentsId === ownerWebContentsId) {
          owned.push({ sessionId, consumerId });
        }
      }
    }
    for (const { sessionId, consumerId } of owned) this.unsubscribe(sessionId, consumerId);
    for (const claim of [...this.revealClaims.values()]) {
      if (claim.ownerWebContentsId === ownerWebContentsId) {
        this.releaseGenerationRevealClaim(claim);
      }
    }
  }

  /**
   * Save a cold checkpoint only when this is the generation's final consumer,
   * then release that consumer in the same main-process turn.
   */
  checkpointAndUnsubscribe(
    sessionId: string,
    consumerId: string,
    checkpoint: PtyRenderCheckpoint
  ): boolean {
    const state = this.sessions.get(sessionId);
    const consumers = this.consumers.get(sessionId);
    const consumer = consumers?.get(consumerId);
    const ownsCurrentGeneration = Boolean(
      state && consumer && consumer.generation === state.generation
    );
    let currentConsumerCount = 0;
    if (state) {
      for (const candidate of consumers?.values() ?? []) {
        if (candidate.generation === state.generation) currentConsumerCount += 1;
      }
    }
    const saved =
      ownsCurrentGeneration && currentConsumerCount === 1
        ? this.saveRenderCheckpoint(sessionId, checkpoint)
        : false;
    this.unsubscribe(sessionId, consumerId);
    if (saved && state) this.scheduleRendererDetach(sessionId, state);
    return saved;
  }

  private scheduleRendererDetach(sessionId: string, state: SessionState): void {
    if (
      !state.tmuxBacked ||
      !state.onRendererIdle ||
      !state.live ||
      !state.renderCheckpoint ||
      state.rendererDetachTimer !== null ||
      this.hasCurrentConsumers(sessionId, state.generation)
    ) {
      return;
    }

    state.rendererDetachTimer = setTimeout(() => {
      state.rendererDetachTimer = null;
      if (
        this.sessions.get(sessionId) !== state ||
        !state.live ||
        !state.renderCheckpoint ||
        this.hasCurrentConsumers(sessionId, state.generation)
      ) {
        return;
      }
      try {
        state.onRendererIdle?.(state.generation);
      } catch (error) {
        log.warn('PtySessionRegistry: renderer-idle detach callback failed', {
          sessionId,
          generation: state.generation,
          error: String(error),
        });
      }
    }, PTY_RENDERER_DETACH_GRACE_MS);
    state.rendererDetachTimer.unref?.();
  }

  private cancelRendererDetach(state: SessionState): void {
    if (state.rendererDetachTimer === null) return;
    clearTimeout(state.rendererDetachTimer);
    state.rendererDetachTimer = null;
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

  private scheduleFinalExit(sessionId: string, state: SessionState): void {
    if (state.flushTimer !== null || !state.pendingExit) return;
    state.flushTimer = setTimeout(() => {
      state.flushTimer = null;
      this.finalizeExitIfDrained(sessionId, state);
    }, 0);
    state.flushTimer.unref?.();
  }

  /** Emit one fairness-bounded batch. Returns true while more output remains. */
  private flushOne(sessionId: string, state: SessionState): boolean {
    if (this.sessions.get(sessionId) !== state || state.pendingByteLength === 0) return false;

    const hasCurrentConsumers = this.hasCurrentConsumers(sessionId, state.generation);
    if (!hasCurrentConsumers) {
      // A compact checkpoint, when present, becomes the canonical owner of this
      // raw tail. Otherwise the replay ring already owns it. In either case no
      // renderer may later receive the same bytes as a numbered live batch.
      if (!this.transferPendingOutputToCheckpoint(state)) this.discardPendingOutput(state);
      return false;
    }
    const tracksConsumerBacklog = !state.pendingExit && hasCurrentConsumers;
    const remainingFlowControlBudget = tracksConsumerBacklog
      ? PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES - state.inflightByteLength
      : PTY_OUTPUT_BATCH_MAX_BYTES;
    if (remainingFlowControlBudget <= 0) {
      return false;
    }

    const { data, byteLength } = takePendingUtf8Batch(
      state,
      Math.min(PTY_OUTPUT_BATCH_MAX_BYTES, remainingFlowControlBudget)
    );
    if (byteLength === 0) {
      // The remaining budget can be smaller than one UTF-8 code point. Pause a
      // few bytes early instead of splitting that character or overshooting.
      if (tracksConsumerBacklog) this.setRendererBackpressured(sessionId, state, true);
      return false;
    }

    state.sequence += 1;

    const payload: PtyDataEvent = {
      generation: state.generation,
      sequence: state.sequence,
      byteLength,
      data,
    };
    // The tracker must observe the same byte/sequence boundary as renderers.
    // Feeding raw onData first would include pending bytes in the checkpoint and
    // then replay those bytes again when they receive a later sequence.
    state.renderCheckpoint?.write(data, state.sequence, byteLength);
    // A checkpoint high-water transition can synchronously fail to pause and
    // terminate this state. Never publish a data batch after that fatal exit.
    if (this.sessions.get(sessionId) !== state) return false;
    events.emit(ptyDataChannel, payload, sessionId);

    if (tracksConsumerBacklog) {
      state.inflightBatches.push({ sequence: state.sequence, byteLength });
      state.inflightByteLength += byteLength;
      if (
        !state.rendererBackpressured &&
        state.inflightByteLength >= PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES
      ) {
        this.setRendererBackpressured(sessionId, state, true);
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

  private discardPendingOutput(state: SessionState): void {
    state.pendingData = [];
    state.pendingDataHead = 0;
    state.pendingByteLength = 0;
  }

  /**
   * Atomically move every unsequenced pending byte into the cold checkpoint.
   * Returns false when no tracker owns the cold terminal state.
   */
  private transferPendingOutputToCheckpoint(state: SessionState): boolean {
    const tracker = state.renderCheckpoint;
    if (!tracker) return false;
    if (state.pendingByteLength === 0) return true;

    for (let index = state.pendingDataHead; index < state.pendingData.length; index += 1) {
      const chunk = state.pendingData[index];
      if (chunk.length === 0) continue;
      tracker.write(chunk.toString('utf8'), state.sequence, chunk.length);
    }
    this.discardPendingOutput(state);
    return true;
  }

  private releaseRenderCheckpoint(
    sessionId: string,
    state: SessionState,
    tracker: PtyRenderCheckpointTracker
  ): void {
    if (state.renderCheckpoint !== tracker) {
      tracker.dispose();
      return;
    }
    state.renderCheckpoint = null;
    tracker.dispose();
    this.setCheckpointBackpressured(sessionId, state, false);
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
    events.emit(ptyExitChannel, { ...pendingExit.info, generation: state.generation }, sessionId);
    try {
      state.onFinalExit?.(pendingExit.info, state.generation);
    } catch (error) {
      log.warn('PTY final-exit callback failed', { error, sessionId });
    }
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
    state.rendererBackpressured = false;
    state.checkpointBackpressured = false;
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

    if (
      state.rendererBackpressured &&
      state.inflightByteLength <= PTY_FLOW_CONTROL_LOW_WATERMARK_BYTES
    ) {
      this.setRendererBackpressured(sessionId, state, false);
    }
  }

  private hasCurrentConsumers(sessionId: string, generation: number): boolean {
    for (const consumer of this.consumers.get(sessionId)?.values() ?? []) {
      if (consumer.generation === generation) return true;
    }
    return false;
  }

  private setRendererBackpressured(
    sessionId: string,
    state: SessionState,
    backpressured: boolean
  ): void {
    if (state.rendererBackpressured === backpressured) return;
    state.rendererBackpressured = backpressured;
    this.updateTransportPause(sessionId, state);
  }

  private setCheckpointBackpressured(
    sessionId: string,
    state: SessionState,
    backpressured: boolean
  ): void {
    if (state.checkpointBackpressured === backpressured) return;
    state.checkpointBackpressured = backpressured;
    this.updateTransportPause(sessionId, state);
  }

  private updateTransportPause(sessionId: string, state: SessionState): void {
    const paused = state.rendererBackpressured || state.checkpointBackpressured;
    if (state.paused === paused) return;
    // Once the backend has exited there is no producer left to resume. The
    // remaining work is only draining already-buffered output to renderers, so
    // do not let a closed PTY's resume implementation block that drain.
    if (!paused && !state.live) {
      state.paused = false;
      return;
    }
    const method = paused ? state.pty.pause : state.pty.resume;
    try {
      method.call(state.pty);
      state.paused = paused;
      if (!paused) {
        this.clearResumeRetry(state);
        this.scheduleFlush(sessionId, state, 0);
      }
    } catch (error) {
      // A backend that cannot pause can continue producing after renderer and
      // checkpoint queues reach their hard bounds. Detach it immediately so
      // main-process memory cannot grow without limit. A failed live resume is
      // different: the transport is still paused, so retrying is safe.
      if (paused) {
        log.warn('PtySessionRegistry: PTY pause failed; terminating session', {
          sessionId,
          error: String(error),
        });
        try {
          state.pty.kill();
        } catch (killError) {
          log.warn('PtySessionRegistry: failed to terminate PTY after pause failure', {
            sessionId,
            error: String(killError),
          });
        }
        if (this.sessions.get(sessionId) === state) {
          // These tokens can no longer ACK or observe this generation. Keeping
          // them alive would leave an offline diagnostics entry until the
          // 90-second lease sweep and could poison flow control after a later
          // same-id registration.
          this.consumers.delete(sessionId);
          state.live = false;
          this.discardPendingOutput(state);
          state.pendingExit = {
            info: { signal: 'PTY_FLOW_CONTROL_FAILURE' },
            preserveBuffer: false,
          };
          this.finalizeExit(sessionId, state);
        }
        return;
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
    if (
      state.resumeRetryTimer !== null ||
      !state.live ||
      !state.paused ||
      state.rendererBackpressured ||
      state.checkpointBackpressured
    ) {
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
      this.updateTransportPause(sessionId, state);
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

  private writeInput(state: SessionState, data: string): void {
    if (!data) return;
    const filtered = state.tmuxInputFilter?.feed(data) ?? data;
    if (filtered) {
      state.lastInputAt = Date.now();
      state.pty.write(filtered);
    }
  }

  private drainPendingInput(
    sessionId: string,
    state: SessionState,
    registrationEpoch: number
  ): void {
    const pending = this.pendingInputs.get(sessionId);
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    this.pendingInputs.delete(sessionId);
    if (pending.epoch !== registrationEpoch || Date.now() >= pending.expiresAt) return;
    for (const chunk of pending.chunks) this.writeInput(state, chunk);
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
    this.notifyRevealClaimWaiters(sessionId);
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
          this.releaseGenerationRevealClaimsForConsumer(sessionId, consumerId);
          changedSessions.add(sessionId);
        }
      }
      if (consumers.size === 0) this.consumers.delete(sessionId);
    }
    for (const sessionId of changedSessions) {
      const state = this.sessions.get(sessionId);
      if (state) {
        if (!this.hasCurrentConsumers(sessionId, state.generation)) {
          this.transferPendingOutputToCheckpoint(state);
        }
        this.pruneAcknowledgedBatches(sessionId, state);
      }
    }
    this.scheduleConsumerLeaseSweep();
  }

  private cleanupLiveState(
    sessionId: string,
    options: { deleteState: boolean; deleteBuffer: boolean }
  ): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    this.releaseGenerationRevealClaimsForSession(sessionId);

    this.cancelRendererDetach(state);

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
    state.rendererBackpressured = false;
    state.checkpointBackpressured = false;
    this.updateTransportPause(sessionId, state);
    this.clearResumeRetry(state);

    if (options.deleteBuffer) state.ringBuffer.clear();
    if (options.deleteState) {
      const tracker = state.renderCheckpoint;
      if (tracker) this.releaseRenderCheckpoint(sessionId, state, tracker);
      this.sessions.delete(sessionId);
    }
  }

  private hasGenerationRevealClaims(sessionId: string): boolean {
    return (this.revealClaimTokensBySession.get(sessionId)?.size ?? 0) > 0;
  }

  private releaseGenerationRevealClaim(claim: GenerationRevealClaim): void {
    if (this.revealClaims.get(claim.token) !== claim) return;
    clearTimeout(claim.timer);
    this.revealClaims.delete(claim.token);
    const tokens = this.revealClaimTokensBySession.get(claim.sessionId);
    tokens?.delete(claim.token);
    if (tokens?.size === 0) this.revealClaimTokensBySession.delete(claim.sessionId);
    this.notifyRevealClaimWaiters(claim.sessionId);
  }

  private releaseGenerationRevealClaimsForConsumer(sessionId: string, consumerId: string): void {
    for (const token of [...(this.revealClaimTokensBySession.get(sessionId) ?? [])]) {
      const claim = this.revealClaims.get(token);
      if (claim?.consumerId === consumerId) this.releaseGenerationRevealClaim(claim);
    }
  }

  private releaseGenerationRevealClaimsForSession(sessionId: string): void {
    for (const token of [...(this.revealClaimTokensBySession.get(sessionId) ?? [])]) {
      const claim = this.revealClaims.get(token);
      if (claim) this.releaseGenerationRevealClaim(claim);
    }
  }

  private notifyRevealClaimWaiters(sessionId: string): void {
    const waiters = this.revealClaimWaiters.get(sessionId);
    if (!waiters) return;
    this.revealClaimWaiters.delete(sessionId);
    for (const resolve of waiters) resolve();
  }
}

export const ptySessionRegistry = new PtySessionRegistry();
