import { useEffect } from 'react';

export function useDismissOnWindowBlur(open: boolean, onDismiss: () => void): void {
  useEffect(() => {
    if (!open) return;

    window.addEventListener('blur', onDismiss);
    return () => window.removeEventListener('blur', onDismiss);
  }, [onDismiss, open]);
}
