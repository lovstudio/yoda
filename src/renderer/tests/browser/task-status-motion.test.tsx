import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mocks = vi.hoisted(() => ({ interruptConversationSession: vi.fn() }));

vi.mock('@renderer/features/tasks/interrupt-task-sessions', () => ({
  interruptConversationSession: mocks.interruptConversationSession,
}));

type MediaQueryController = {
  mediaQueryList: MediaQueryList;
  setMatches: (matches: boolean) => void;
};

function createMediaQueryController(initialMatches = false): MediaQueryController {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = '(prefers-reduced-motion: reduce)';
  const mediaQueryList = {
    get matches() {
      return matches;
    },
    media,
    onchange: null,
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject): void => {
      if (typeof listener === 'function') {
        listeners.add(listener as (event: MediaQueryListEvent) => void);
      }
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject): void => {
      if (typeof listener === 'function') {
        listeners.delete(listener as (event: MediaQueryListEvent) => void);
      }
    },
    addListener: (listener: (event: MediaQueryListEvent) => void): void => {
      listeners.add(listener);
    },
    removeListener: (listener: (event: MediaQueryListEvent) => void): void => {
      listeners.delete(listener);
    },
    dispatchEvent: () => true,
  } as MediaQueryList;

  return {
    mediaQueryList,
    setMatches: (nextMatches) => {
      matches = nextMatches;
      const event = { matches, media } as MediaQueryListEvent;
      for (const listener of listeners) listener(event);
    },
  };
}

describe('task status motion', () => {
  let host: HTMLDivElement;
  let root: Root | null;
  let visibilityState: DocumentVisibilityState;
  let mediaQuery: MediaQueryController;

  beforeEach(() => {
    vi.useFakeTimers();
    visibilityState = 'visible';
    mediaQuery = createMediaQueryController();
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibilityState);
    vi.spyOn(window, 'matchMedia').mockImplementation(() => mediaQuery.mediaQueryList);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('uses one stable interval and clears it on unmount', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const { CLISpinner } = await import('@renderer/features/tasks/components/cliSpinner');
    await act(async () => root?.render(createElement(CLISpinner)));

    expect(host.textContent).toBe('⠋');
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTime(240));

    expect(host.textContent).toBe('⠸');
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    await act(async () => root?.unmount());
    root = null;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pauses while the document is hidden and resumes when visible', async () => {
    const { CLISpinner } = await import('@renderer/features/tasks/components/cliSpinner');
    await act(async () => root?.render(createElement(CLISpinner)));
    await act(async () => vi.advanceTimersByTime(80));
    expect(host.textContent).toBe('⠙');

    visibilityState = 'hidden';
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => vi.advanceTimersByTime(240));
    expect(host.textContent).toBe('⠙');

    visibilityState = 'visible';
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => vi.advanceTimersByTime(80));
    expect(host.textContent).toBe('⠹');
  });

  it('keeps the first frame static while reduced motion is preferred', async () => {
    mediaQuery.setMatches(true);
    const { CLISpinner } = await import('@renderer/features/tasks/components/cliSpinner');
    await act(async () => root?.render(createElement(CLISpinner, { variant: '2' })));

    expect(host.textContent).toBe('⠈');
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => vi.advanceTimersByTime(800));
    expect(host.textContent).toBe('⠈');

    await act(async () => mediaQuery.setMatches(false));
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => vi.advanceTimersByTime(80));
    expect(host.textContent).toBe('⠉');
  });

  it('uses motion-safe status animations without changing indicator semantics', async () => {
    const { AgentStatusIndicator } = await import(
      '@renderer/features/tasks/components/agent-status-indicator'
    );
    await act(async () =>
      root?.render(
        createElement(AgentStatusIndicator, {
          status: 'working',
          disableTooltip: true,
        })
      )
    );

    const workingIcon = host.querySelector('svg');
    expect(workingIcon?.classList.contains('motion-safe:animate-spin')).toBe(true);
    expect(workingIcon?.classList.contains('animate-spin')).toBe(false);

    await act(async () =>
      root?.render(
        createElement(AgentStatusIndicator, {
          status: 'awaiting-input',
          disableTooltip: true,
        })
      )
    );

    const awaitingIcon = host.querySelector('svg');
    expect(awaitingIcon?.getAttribute('aria-label')).toBe('agentStatus.awaiting-input');
    expect(awaitingIcon?.classList.contains('motion-safe:animate-pulse')).toBe(true);
    expect(awaitingIcon?.classList.contains('animate-pulse')).toBe(false);

    // A `working` indicator given its session identity is the interrupt
    // control: it keeps the spinner until hover, and clicking interrupts that
    // session. Nested inside already-clickable rows, so it is a `role="button"`
    // span rather than a `<button>`.
    const session = { projectId: 'project-1', taskId: 'task-1', conversationId: 'conversation-1' };
    await act(async () =>
      root?.render(
        createElement(AgentStatusIndicator, {
          status: 'working',
          disableTooltip: true,
          session,
        })
      )
    );

    const interruptControl = host.querySelector<HTMLElement>('[role="button"]');
    expect(interruptControl?.tagName).toBe('SPAN');
    expect(interruptControl?.getAttribute('aria-label')).toBe('agentStatus.interrupt');
    expect(
      interruptControl?.querySelector('svg')?.classList.contains('motion-safe:animate-spin')
    ).toBe(true);
    await act(async () => interruptControl?.click());
    expect(mocks.interruptConversationSession).toHaveBeenCalledWith(session);
  });
});
