import type { IDisposable, Terminal } from '@xterm/xterm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTerminalImeDiagnostics } from './terminal-ime-diagnostics';

function createHarness() {
  const listeners = new Map<string, EventListener>();
  const addEventListener = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
    listeners.set(type, listener as EventListener);
  });
  const removeEventListener = vi.fn((type: string) => listeners.delete(type));
  const eventTarget = { addEventListener, removeEventListener } as unknown as Document;
  const dataDisposable: IDisposable = { dispose: vi.fn() };
  let dataListener: ((data: string) => void) | null = null;
  const onData = vi.fn((listener: (data: string) => void) => {
    dataListener = listener;
    return dataDisposable;
  });
  const textarea = {
    value: '',
    selectionStart: 0,
    selectionEnd: 0,
  } as HTMLTextAreaElement;
  const terminal = { textarea, onData } as unknown as Terminal;

  return {
    addEventListener,
    dataDisposable,
    eventTarget,
    getDataListener: () => dataListener,
    listeners,
    onData,
    removeEventListener,
    terminal,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('terminal IME diagnostics', () => {
  it('takes the constant-disabled path without registering listeners or microtasks', () => {
    const harness = createHarness();
    const scheduleMicrotask = vi.fn();

    const disposable = registerTerminalImeDiagnostics(harness.terminal, {
      eventTarget: harness.eventTarget,
      scheduleMicrotask,
    });

    expect(harness.addEventListener).not.toHaveBeenCalled();
    expect(harness.onData).not.toHaveBeenCalled();
    expect(scheduleMicrotask).not.toHaveBeenCalled();

    disposable.dispose();
    expect(harness.removeEventListener).not.toHaveBeenCalled();
    expect(harness.dataDisposable.dispose).not.toHaveBeenCalled();
  });

  it('preserves listener, deferred-event, data, and disposal semantics when enabled', () => {
    const harness = createHarness();
    const scheduleMicrotask = vi.fn();
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.stubGlobal('KeyboardEvent', class {});
    vi.stubGlobal('InputEvent', class {});
    vi.stubGlobal('CompositionEvent', class {});

    const disposable = registerTerminalImeDiagnostics(harness.terminal, {
      enabled: true,
      eventTarget: harness.eventTarget,
      scheduleMicrotask,
    });

    expect(harness.addEventListener).toHaveBeenCalledTimes(8);
    expect(harness.listeners.size).toBe(8);
    expect(harness.onData).toHaveBeenCalledTimes(1);

    harness.listeners.get('keydown')?.({
      type: 'keydown',
      target: harness.terminal.textarea,
      composedPath: () => [harness.terminal.textarea],
      defaultPrevented: false,
      cancelable: true,
      timeStamp: 1,
    } as unknown as Event);
    expect(scheduleMicrotask).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledWith(
      '[yoda:trace-ime]',
      'capture',
      expect.objectContaining({ type: 'keydown' })
    );
    scheduleMicrotask.mock.calls[0]?.[0]();
    expect(debug).toHaveBeenCalledWith(
      '[yoda:trace-ime]',
      'after',
      expect.objectContaining({ type: 'keydown' })
    );

    harness.getDataListener()?.('a');
    expect(debug).toHaveBeenCalledWith(
      '[yoda:trace-ime]',
      'xterm:onData',
      expect.objectContaining({ data: 'a', length: 1 })
    );

    disposable.dispose();
    expect(harness.removeEventListener).toHaveBeenCalledTimes(8);
    expect(harness.dataDisposable.dispose).toHaveBeenCalledTimes(1);
  });
});
