import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginTaskOpenTrace,
  cancelTaskOpenTrace,
  completeTaskOpenTrace,
  markTaskOpenTrace,
} from './task-open-performance';

const PROJECT_ID = 'performance-project';
const TASK_ID = 'performance-task';

class FakeVisibilityDocument extends EventTarget {
  private state: DocumentVisibilityState;
  private readonly visibilityListeners = new Set<EventListenerOrEventListenerObject>();

  constructor(initialState: DocumentVisibilityState) {
    super();
    this.state = initialState;
  }

  get visibilityState(): DocumentVisibilityState {
    return this.state;
  }

  get visibilityListenerCount(): number {
    return this.visibilityListeners.size;
  }

  override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void {
    super.addEventListener(type, callback, options);
    if (type === 'visibilitychange' && callback) this.visibilityListeners.add(callback);
  }

  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ): void {
    super.removeEventListener(type, callback, options);
    if (type === 'visibilitychange' && callback) this.visibilityListeners.delete(callback);
  }

  setVisibilityState(nextState: DocumentVisibilityState): void {
    this.state = nextState;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

describe('task open performance visibility timing', () => {
  let now: number;
  let visibilityDocument: FakeVisibilityDocument;
  let logSpy: ReturnType<typeof vi.spyOn>;

  const loggedDetails = (stage: string): Record<string, unknown> => {
    const calls = logSpy.mock.calls as unknown as Array<[unknown, unknown?]>;
    const call = calls.find(([message]) => message === `[DEBUG][task-open] ${stage}:`);
    expect(call, `missing ${stage} task-open log`).toBeDefined();
    return call?.[1] as Record<string, unknown>;
  };

  beforeEach(() => {
    now = 100;
    visibilityDocument = new FakeVisibilityDocument('visible');
    vi.stubGlobal('document', visibilityDocument);
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(Date, 'now').mockReturnValue(1_786_636_588_440);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    cancelTaskOpenTrace(PROJECT_ID, TASK_ID, { reason: 'test-cleanup' });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('records a hidden click and excludes its initial hidden interval from visible elapsed time', () => {
    visibilityDocument.setVisibilityState('hidden');
    beginTaskOpenTrace(PROJECT_ID, TASK_ID);

    expect(loggedDetails('click')).toMatchObject({
      visibilityStateAtClick: 'hidden',
      visibilityState: 'hidden',
      hiddenDurationMs: 0,
      visibleElapsedMs: 0,
    });

    now = 250;
    visibilityDocument.setVisibilityState('visible');
    now = 300;
    markTaskOpenTrace(PROJECT_ID, TASK_ID, 'target-hydrated');

    expect(loggedDetails('target-hydrated')).toMatchObject({
      elapsedMs: 200,
      hiddenDurationMs: 150,
      visibleElapsedMs: 50,
      visibleSegmentMs: 50,
    });

    completeTaskOpenTrace(PROJECT_ID, TASK_ID);
  });

  it('accumulates multiple visible-to-hidden intervals across visibility changes', () => {
    beginTaskOpenTrace(PROJECT_ID, TASK_ID);

    now = 160;
    visibilityDocument.setVisibilityState('hidden');
    now = 260;
    visibilityDocument.setVisibilityState('visible');
    now = 300;
    visibilityDocument.setVisibilityState('hidden');
    now = 450;
    visibilityDocument.setVisibilityState('visible');
    now = 500;
    markTaskOpenTrace(PROJECT_ID, TASK_ID, 'route-committed');

    expect(loggedDetails('route-committed')).toMatchObject({
      visibilityStateAtClick: 'visible',
      visibilityState: 'visible',
      elapsedMs: 400,
      hiddenDurationMs: 250,
      visibleElapsedMs: 150,
      visibleSegmentMs: 150,
    });

    completeTaskOpenTrace(PROJECT_ID, TASK_ID);
  });

  it('settles an in-progress hidden interval when the trace completes', () => {
    beginTaskOpenTrace(PROJECT_ID, TASK_ID);
    expect(visibilityDocument.visibilityListenerCount).toBe(1);

    now = 220;
    visibilityDocument.setVisibilityState('hidden');
    now = 500;
    completeTaskOpenTrace(PROJECT_ID, TASK_ID);

    expect(loggedDetails('painted')).toMatchObject({
      visibilityStateAtClick: 'visible',
      visibilityState: 'hidden',
      elapsedMs: 400,
      hiddenDurationMs: 280,
      visibleElapsedMs: 120,
      visibleSegmentMs: 120,
    });
    expect(visibilityDocument.visibilityListenerCount).toBe(0);
  });

  it('settles and logs hidden time when a newer trace cancels the active trace', () => {
    const firstContextId = beginTaskOpenTrace(PROJECT_ID, TASK_ID);
    now = 200;
    visibilityDocument.setVisibilityState('hidden');
    now = 350;

    const nextContextId = beginTaskOpenTrace('next-project', 'next-task');

    expect(loggedDetails('cancelled')).toMatchObject({
      projectId: PROJECT_ID,
      taskId: TASK_ID,
      reason: 'superseded',
      elapsedMs: 250,
      hiddenDurationMs: 150,
      visibleElapsedMs: 100,
    });
    expect(visibilityDocument.visibilityListenerCount).toBe(1);

    // A superseded same-task opener can settle after its replacement. Its
    // cleanup must not cancel the replacement trace through the shared key.
    cancelTaskOpenTrace('next-project', 'next-task', undefined, firstContextId);
    expect(visibilityDocument.visibilityListenerCount).toBe(1);

    cancelTaskOpenTrace('next-project', 'next-task', undefined, nextContextId);
    expect(visibilityDocument.visibilityListenerCount).toBe(0);
  });
});
