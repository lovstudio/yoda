import { useCallback, useRef } from 'react';

/**
 * Constrains Cmd/Ctrl+A to a single container instead of selecting the whole
 * document. Spread the returned props onto a scrollable text preview (e.g. a
 * file-content `<pre>`); the element becomes focusable so a select-all while
 * focused only highlights its own contents.
 */
export function useScopedSelectAll<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  const onKeyDown = useCallback((event: React.KeyboardEvent<T>) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'a') return;
    const el = ref.current;
    const selection = window.getSelection();
    if (!el || !selection) return;
    event.preventDefault();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  return { ref, tabIndex: 0, onKeyDown };
}
