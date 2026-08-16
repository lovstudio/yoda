/**
 * Yoda's bar dressed for the browser. The layout is the shared strip's; this is
 * only the three class names it needs, read off the compiled CSS-module map.
 */
import type { RuntimeBarTheme } from '@yoda/runtime-bar/contract';
import css from './bar.module.css';

export const DSH_RUNTIME_BAR_THEME: RuntimeBarTheme = {
  strip: css.strip ?? '',
  sessionGroup: css.sessionGroup ?? '',
  spacer: css.spacer ?? '',
};
