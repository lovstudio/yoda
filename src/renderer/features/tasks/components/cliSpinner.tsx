import { useEffect, useState } from 'react';

const SPINNER_INTERVAL_MS = 80;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const FRAMES_1 = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAMES_2 = [
  '⠈',
  '⠉',
  '⠋',
  '⠓',
  '⠒',
  '⠐',
  '⠐',
  '⠒',
  '⠖',
  '⠦',
  '⠤',
  '⠠',
  '⠠',
  '⠤',
  '⠦',
  '⠖',
  '⠒',
  '⠐',
  '⠐',
  '⠒',
  '⠓',
  '⠋',
  '⠉',
  '⠈',
];

export function CLISpinner({ variant = '1' }: { variant?: '1' | '2' }) {
  const [index, setIndex] = useState(0);
  const [documentVisible, setDocumentVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
  );
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== 'undefined' && window.matchMedia?.(REDUCED_MOTION_QUERY).matches === true
  );
  const frames = variant === '1' ? FRAMES_1 : FRAMES_2;

  useEffect(() => {
    const handleVisibilityChange = () => setDocumentVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia?.(REDUCED_MOTION_QUERY);
    if (!mediaQuery) return;
    const handleChange = () => setReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (!documentVisible || reducedMotion) return;
    const interval = window.setInterval(() => {
      setIndex((current) => (current + 1) % frames.length);
    }, SPINNER_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [documentVisible, frames, reducedMotion]);

  const visibleIndex = reducedMotion ? 0 : index % frames.length;
  return <span className="text-foreground/60">{frames[visibleIndex]}</span>;
}
