import type { MemberAccent, MemberStatus } from '@shared/team-room';

/** Per-member identity accent → tailwind utility classes (design-system palette, no raw hex). */
export const ACCENT_AVATAR: Record<MemberAccent, string> = {
  terra: 'bg-primary text-primary-foreground',
  amber: 'bg-amber-500 text-amber-950',
  teal: 'bg-teal-500 text-teal-950',
  violet: 'bg-violet-400 text-violet-950',
  slate: 'bg-slate-500 text-slate-950',
};

export const ACCENT_TEXT: Record<MemberAccent, string> = {
  terra: 'text-primary',
  amber: 'text-amber-500',
  teal: 'text-teal-500',
  violet: 'text-violet-400',
  slate: 'text-slate-400',
};

export const ACCENT_MENTION: Record<MemberAccent, string> = {
  terra: 'bg-primary/15 text-primary',
  amber: 'bg-amber-500/15 text-amber-600 ydark:text-amber-400',
  teal: 'bg-teal-500/15 text-teal-600 ydark:text-teal-400',
  violet: 'bg-violet-400/15 text-violet-500 ydark:text-violet-300',
  slate: 'bg-slate-500/15 text-slate-500',
};

/** Status dot color + animation. */
export const STATUS_DOT: Record<MemberStatus, string> = {
  idle: 'bg-foreground-muted/50',
  waiting: 'bg-amber-500/70 animate-pulse',
  running: 'bg-teal-500 animate-pulse',
  finished: 'bg-emerald-500',
  error: 'bg-red-500',
  'awaiting-input': 'bg-amber-500 animate-pulse',
};

export const STATUS_LABEL: Record<MemberStatus, string> = {
  idle: 'idle',
  waiting: 'waiting',
  running: 'running',
  finished: 'finished',
  error: 'error',
  'awaiting-input': 'awaiting input',
};
