import type { CustomTheme } from '@shared/custom-theme';

type CssVarMap = Record<string, string>;

export const CUSTOM_THEME_CSS_VARIABLES = [
  '--background',
  '--background-1',
  '--background-2',
  '--background-3',
  '--foreground',
  '--foreground-inverse',
  '--foreground-muted',
  '--foreground-passive',
  '--background-secondary',
  '--background-secondary-1',
  '--background-secondary-2',
  '--background-secondary-3',
  '--foreground-secondary',
  '--foreground-secondary-muted',
  '--foreground-secondary-passive',
  '--background-tertiary',
  '--background-tertiary-1',
  '--background-tertiary-2',
  '--background-tertiary-3',
  '--foreground-tertiary',
  '--foreground-tertiary-muted',
  '--foreground-tertiary-passive',
  '--background-quaternary',
  '--background-quaternary-1',
  '--background-quaternary-2',
  '--background-destructive',
  '--background-destructive-1',
  '--foreground-destructive',
  '--foreground-destructive-muted',
  '--background-neutral',
  '--foreground-neutral',
  '--primary-button-background',
  '--primary-button-background-hover',
  '--primary-button-foreground',
  '--primary-button-border',
  '--primary',
  '--primary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
  '--input',
  '--border',
  '--border-1',
  '--border-2',
  '--border-destructive',
  '--border-primary',
  '--ring',
  '--selection',
  '--selection-foreground',
  '--status-in-progress',
  '--status-in-review',
  '--status-done',
  '--status-todo',
  '--status-cancelled',
  '--monaco-bg',
  '--monaco-fg',
  '--monaco-error-fg',
  '--monaco-line-highlight',
  '--monaco-line-number',
  '--monaco-gutter',
  '--monaco-inserted-text-bg',
  '--monaco-inserted-line-bg',
  '--monaco-inserted-text-border',
  '--monaco-removed-text-bg',
  '--monaco-removed-line-bg',
  '--monaco-removed-text-border',
  '--monaco-unchanged-region-bg',
  '--monaco-diff-border',
  '--monaco-diff-diagonal-fill',
  '--monaco-selection-bg',
  '--monaco-selection-fg',
  '--monaco-inactive-selection-bg',
  '--xterm-bg',
  '--xterm-fg',
  '--xterm-cursor',
  '--xterm-cursor-accent',
  '--xterm-selection-bg',
  '--xterm-selection-fg',
  '--foreground-diff-added',
  '--foreground-diff-modified',
  '--foreground-diff-deleted',
  '--diff-added',
  '--diff-modified',
  '--diff-deleted',
  '--diff-added-bg',
  '--diff-modified-bg',
  '--diff-deleted-bg',
] as const;

export function buildCustomThemeCssVars(theme: CustomTheme): CssVarMap {
  const c = theme.colors;
  const isDark = theme.mode === 'dark';
  const skinSurfaceAdjustment = theme.skin
    ? (theme.skin.imageTreatment.overlayStrength - 0.34) * 0.22
    : 0;
  const surface = (color: string, opacity: number) =>
    theme.skin
      ? transparent(color, Math.max(0.62, Math.min(0.98, opacity + skinSurfaceAdjustment)))
      : color;
  const destructiveBg = mix(c.diffDeleted, c.background, isDark ? 0.24 : 0.1);
  const destructiveBg1 = mix(c.diffDeleted, c.background, isDark ? 0.3 : 0.16);
  const destructiveMuted = mix(c.diffDeleted, c.foregroundMuted, 0.72);
  const selection = mix(c.primaryButtonBackground, c.background, isDark ? 0.55 : 0.35);
  const selectionForeground = isDark ? c.foreground : c.background;
  const tertiaryBg = isDark ? c.background : c.background2;
  const tertiaryBg1 = isDark ? c.background1 : mix(c.background3, c.background2, 0.55);
  const tertiaryBg2 = isDark ? c.background2 : c.background3;
  const tertiaryBg3 = isDark ? c.background3 : mix(c.foreground, c.background3, 0.05);
  // Popup surfaces sit one elevation step above the page: dark lifts to
  // background-1, light lifts toward white while keeping the theme hue.
  const quaternaryBg = isDark ? c.background1 : mix('#ffffff', c.background, 0.75);

  return {
    '--background': surface(c.background, isDark ? 0.88 : 0.86),
    '--background-1': surface(c.background1, 0.9),
    '--background-2': surface(c.background2, 0.91),
    '--background-3': surface(c.background3, 0.9),
    '--foreground': c.foreground,
    '--foreground-inverse': c.background,
    '--foreground-muted': c.foregroundMuted,
    '--foreground-passive': c.foregroundPassive,
    '--background-secondary': surface(isDark ? c.background : c.background1, 0.88),
    '--background-secondary-1': surface(isDark ? c.background1 : c.background, 0.9),
    '--background-secondary-2': surface(c.background2, 0.9),
    '--background-secondary-3': surface(c.background3, 0.9),
    '--foreground-secondary': c.foreground,
    '--foreground-secondary-muted': c.foregroundMuted,
    '--foreground-secondary-passive': c.foregroundPassive,
    '--background-tertiary': surface(tertiaryBg, 0.76),
    '--background-tertiary-1': surface(tertiaryBg1, 0.82),
    '--background-tertiary-2': surface(tertiaryBg2, 0.86),
    '--background-tertiary-3': surface(tertiaryBg3, 0.9),
    '--foreground-tertiary': c.foreground,
    '--foreground-tertiary-muted': c.foregroundMuted,
    '--foreground-tertiary-passive': c.foregroundPassive,
    '--background-quaternary': surface(quaternaryBg, 0.96),
    '--background-quaternary-1': surface(isDark ? c.background2 : c.background1, 0.97),
    '--background-quaternary-2': surface(isDark ? c.background3 : c.background2, 0.97),
    '--background-destructive': destructiveBg,
    '--background-destructive-1': destructiveBg1,
    '--foreground-destructive': c.diffDeleted,
    '--foreground-destructive-muted': destructiveMuted,
    '--background-neutral': c.foreground,
    '--foreground-neutral': c.background,
    '--primary-button-background': c.primaryButtonBackground,
    '--primary-button-background-hover': c.primaryButtonBackgroundHover,
    '--primary-button-foreground': c.primaryButtonForeground,
    '--primary-button-border': c.primaryButtonBorder,
    '--primary': c.primaryButtonBackground,
    '--primary-foreground': c.primaryButtonForeground,
    '--muted': c.background2,
    '--muted-foreground': c.foregroundMuted,
    '--accent': c.background2,
    '--accent-foreground': c.foreground,
    '--destructive': c.diffDeleted,
    '--input': c.border,
    '--border': c.border,
    '--border-1': c.border1,
    '--border-2': c.border2,
    '--border-destructive': mix(c.diffDeleted, c.border, 0.65),
    '--border-primary': c.border2,
    '--ring': c.border2,
    '--selection': selection,
    '--selection-foreground': selectionForeground,
    '--status-in-progress': c.statusInProgress,
    '--status-in-review': c.statusInReview,
    '--status-done': c.statusDone,
    '--status-todo': c.statusTodo,
    '--status-cancelled': c.statusCancelled,
    '--monaco-bg': isDark ? c.background1 : c.background,
    '--monaco-fg': c.foregroundMuted,
    '--monaco-error-fg': c.diffDeleted,
    '--monaco-line-highlight': c.background2,
    '--monaco-line-number': c.foregroundPassive,
    '--monaco-gutter': isDark ? c.background1 : c.background,
    '--monaco-inserted-text-bg': transparent(c.diffAdded, isDark ? 0.32 : 0.22),
    '--monaco-inserted-line-bg': transparent(c.diffAdded, isDark ? 0.14 : 0.1),
    '--monaco-inserted-text-border': transparent(c.diffAdded, 0.45),
    '--monaco-removed-text-bg': transparent(c.diffDeleted, isDark ? 0.34 : 0.22),
    '--monaco-removed-line-bg': transparent(c.diffDeleted, isDark ? 0.16 : 0.1),
    '--monaco-removed-text-border': transparent(c.diffDeleted, 0.45),
    '--monaco-unchanged-region-bg': c.background2,
    '--monaco-diff-border': c.border,
    '--monaco-diff-diagonal-fill': c.background2,
    '--monaco-selection-bg': selection,
    '--monaco-selection-fg': selectionForeground,
    '--monaco-inactive-selection-bg': transparent(c.foreground, isDark ? 0.16 : 0.1),
    '--xterm-bg': isDark ? c.background1 : c.background,
    '--xterm-fg': c.foreground,
    '--xterm-cursor': c.foreground,
    '--xterm-cursor-accent': isDark ? c.background1 : c.background,
    '--xterm-selection-bg': selection,
    '--xterm-selection-fg': selectionForeground,
    '--foreground-diff-added': c.diffAdded,
    '--foreground-diff-modified': c.diffModified,
    '--foreground-diff-deleted': c.diffDeleted,
    '--diff-added': c.diffAdded,
    '--diff-modified': c.diffModified,
    '--diff-deleted': c.diffDeleted,
    '--diff-added-bg': transparent(c.diffAdded, isDark ? 0.16 : 0.1),
    '--diff-modified-bg': transparent(c.diffModified, isDark ? 0.16 : 0.1),
    '--diff-deleted-bg': transparent(c.diffDeleted, isDark ? 0.16 : 0.1),
  };
}

export function getCustomThemeFingerprint(theme: CustomTheme | undefined): string {
  if (!theme) return 'builtin';
  return `${theme.id}:${theme.mode}:${Object.values(theme.colors).join(':')}:${JSON.stringify(theme.skin ?? null)}`;
}

function mix(foreground: string, background: string, foregroundWeight: number): string {
  const fg = hexToRgb(foreground);
  const bg = hexToRgb(background);
  const weight = Math.max(0, Math.min(1, foregroundWeight));
  return rgbToHex([
    Math.round(fg[0] * weight + bg[0] * (1 - weight)),
    Math.round(fg[1] * weight + bg[1] * (1 - weight)),
    Math.round(fg[2] * weight + bg[2] * (1 - weight)),
  ]);
}

function transparent(color: string, alpha: number): string {
  const [r, g, b] = hexToRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}
