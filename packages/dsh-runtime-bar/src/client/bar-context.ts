/**
 * What a bar entry can read. Entries take no props — that is the shared
 * contract, and it is what lets one bar carry Electron entries in one host and
 * browser entries in another — so the mounted bar resolves the session facts
 * once and hands them down through this context.
 */
import { createContext, useContext } from 'react';
import type { BarJobView, BarSessionSummary } from '../context-types.ts';
import type { BarTranslate } from './locales.ts';

/** The session slice the bar's entries render. */
export type BarView = {
  /** The slot's session; the framework resolves it, entries never pick one. */
  sessionId: string;
  /**
   * The session's list row, absent until the list feed carries it. Entries
   * render nothing rather than a placeholder while it is missing: an empty seat
   * in a status bar reads as "nothing to report", which would be a lie.
   */
  session: BarSessionSummary | undefined;
  /** Background jobs of this session; empty when the runtime publishes none. */
  jobs: readonly BarJobView[];
  /** Total sessions in the list. */
  sessionCount: number;
  /** How many of them are running. */
  runningSessionCount: number;
  t: BarTranslate;
  /** Hand an absolute path to the Host operating system. */
  openPath: (path: string) => void;
};

const BarViewContext = createContext<BarView | null>(null);

export const BarViewProvider = BarViewContext.Provider;

/**
 * Read the bar's session facts. Throws outside the bar: an entry that renders
 * without one is a registration mistake, and a silent fallback would hide it
 * behind an entry that merely looks empty.
 */
export function useBarSession(): BarView {
  const view = useContext(BarViewContext);
  if (view === null) {
    throw new Error('dsh-runtime-bar: a bar entry rendered outside the bar');
  }
  return view;
}
