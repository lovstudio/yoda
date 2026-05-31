import type { IDisposable, Terminal } from '@xterm/xterm';

const TRACE_IME_STORAGE_KEY = 'yoda:trace-ime';

const IME_EVENT_TYPES = [
  'keydown',
  'keypress',
  'keyup',
  'beforeinput',
  'input',
  'compositionstart',
  'compositionupdate',
  'compositionend',
] as const;

type ImeEventType = (typeof IME_EVENT_TYPES)[number];

function isImeTraceEnabled(): boolean {
  try {
    const value = window.localStorage.getItem(TRACE_IME_STORAGE_KEY);
    return value === '1' || value === 'true';
  } catch {
    return false;
  }
}

function isImeEventType(type: string): type is ImeEventType {
  return IME_EVENT_TYPES.includes(type as ImeEventType);
}

function getTextareaSummary(textarea: HTMLTextAreaElement | undefined): {
  valueLength: number;
  selectionStart: number | null;
  selectionEnd: number | null;
} | null {
  if (!textarea) return null;
  return {
    valueLength: textarea.value.length,
    selectionStart: textarea.selectionStart,
    selectionEnd: textarea.selectionEnd,
  };
}

function getKeyboardDetails(event: KeyboardEvent) {
  return {
    key: event.key,
    code: event.code,
    keyCode: event.keyCode,
    charCode: event.charCode,
    which: event.which,
    repeat: event.repeat,
    isComposing: event.isComposing,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
  };
}

function getInputDetails(event: InputEvent) {
  return {
    data: event.data,
    inputType: event.inputType,
    isComposing: event.isComposing,
    composed: event.composed,
  };
}

function getCompositionDetails(event: CompositionEvent) {
  return {
    data: event.data,
  };
}

function getEventDetails(event: Event) {
  if (event instanceof KeyboardEvent) return getKeyboardDetails(event);
  if (event instanceof InputEvent) return getInputDetails(event);
  if (event instanceof CompositionEvent) return getCompositionDetails(event);
  return {};
}

function isFromTextarea(event: Event, textarea: HTMLTextAreaElement | undefined): boolean {
  if (!textarea) return false;
  const target = event.target;
  if (target === textarea) return true;
  return event.composedPath().includes(textarea);
}

function logImeEvent(
  phase: 'capture' | 'after',
  event: Event,
  textarea: HTMLTextAreaElement | undefined
): void {
  if (!isImeTraceEnabled()) return;
  if (!isImeEventType(event.type)) return;
  if (!isFromTextarea(event, textarea)) return;

  console.debug('[yoda:trace-ime]', phase, {
    type: event.type,
    defaultPrevented: event.defaultPrevented,
    cancelable: event.cancelable,
    timeStamp: event.timeStamp,
    textarea: getTextareaSummary(textarea),
    ...getEventDetails(event),
  });
}

function logTerminalData(data: string): void {
  if (!isImeTraceEnabled()) return;
  console.debug('[yoda:trace-ime]', 'xterm:onData', {
    data,
    length: data.length,
    codePoints: Array.from(data).map((char) => char.codePointAt(0)),
  });
}

export function registerTerminalImeDiagnostics(terminal: Terminal): IDisposable {
  const textarea = terminal.textarea;
  const disposables: IDisposable[] = [];

  const listener = (event: Event) => {
    logImeEvent('capture', event, textarea);
    queueMicrotask(() => logImeEvent('after', event, textarea));
  };

  for (const eventType of IME_EVENT_TYPES) {
    document.addEventListener(eventType, listener, true);
    disposables.push({
      dispose: () => document.removeEventListener(eventType, listener, true),
    });
  }

  disposables.push(terminal.onData((data) => logTerminalData(data)));

  return {
    dispose: () => {
      for (const disposable of disposables) {
        disposable.dispose();
      }
      disposables.length = 0;
    },
  };
}
