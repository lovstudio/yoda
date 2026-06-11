import type { IDisposable, Terminal } from '@xterm/xterm';

const NATIVE_PUNCTUATION_STORAGE_KEY = 'yoda:terminal-ime-native-punctuation';
const FALLBACK_DELAY_MS = 30;

const PUNCTUATION_CODES = new Set([
  'Backquote',
  'BracketLeft',
  'BracketRight',
  'Comma',
  'Digit0',
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'Digit6',
  'Digit7',
  'Digit8',
  'Digit9',
  'Equal',
  'IntlBackslash',
  'IntlRo',
  'IntlYen',
  'Minus',
  'Period',
  'Quote',
  'Semicolon',
  'Slash',
]);

interface PendingPunctuation {
  fallbackData: string;
  timer: ReturnType<typeof setTimeout>;
}

// Default-on; localStorage value '0'/'false' is the kill switch if some IME misbehaves.
function isEnabled(): boolean {
  try {
    const value = window.localStorage.getItem(NATIVE_PUNCTUATION_STORAGE_KEY);
    return value !== '0' && value !== 'false';
  } catch {
    return true;
  }
}

function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}

function isAsciiPrintable(value: string): boolean {
  if (value.length !== 1) return false;
  const codePoint = value.charCodeAt(0);
  return codePoint >= 0x20 && codePoint <= 0x7e;
}

function shouldUseNativeTextInput(event: KeyboardEvent): boolean {
  if (!isEnabled()) return false;
  if (!isMacPlatform()) return false;
  // During IME composition (or keyCode 229, i.e. the key was consumed by the
  // IME) these keys select candidates — deferring would also arm a fallback
  // that injects a stray ASCII char after the composition commits.
  if (event.isComposing || event.keyCode === 229) return false;
  if (event.ctrlKey || event.altKey || event.metaKey) return false;
  if (!PUNCTUATION_CODES.has(event.code)) return false;
  return isAsciiPrintable(event.key);
}

export interface TerminalImeNativePunctuationBridge extends IDisposable {
  shouldDeferToNativeInput(event: KeyboardEvent): boolean;
}

export function registerTerminalImeNativePunctuation(
  terminal: Terminal
): TerminalImeNativePunctuationBridge {
  const textarea = terminal.textarea;
  let pending: PendingPunctuation | null = null;

  const clearPending = () => {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending = null;
  };

  const scheduleFallback = (fallbackData: string) => {
    clearPending();
    pending = {
      fallbackData,
      timer: setTimeout(() => {
        const data = pending?.fallbackData;
        pending = null;
        if (data) terminal.input(data);
      }, FALLBACK_DELAY_MS),
    };
  };

  const inputListener = (event: Event) => {
    if (!pending) return;
    if (!textarea || event.target !== textarea) return;
    if (!(event instanceof InputEvent)) return;
    if (event.inputType !== 'insertText' || !event.data) return;

    event.stopImmediatePropagation();
    event.stopPropagation();

    const data = event.data;
    clearPending();
    textarea.value = '';
    terminal.input(data);
  };

  document.addEventListener('input', inputListener, true);

  return {
    shouldDeferToNativeInput(event: KeyboardEvent): boolean {
      if (event.type === 'keyup') {
        return false;
      }

      if (!shouldUseNativeTextInput(event)) {
        return false;
      }

      if (event.type === 'keydown') {
        scheduleFallback(event.key);
      }

      return true;
    },

    dispose(): void {
      clearPending();
      document.removeEventListener('input', inputListener, true);
    },
  };
}
