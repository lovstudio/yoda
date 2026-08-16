/**
 * Whether this session is doing anything. Four states, one dot: waiting for the
 * user outranks running (a blocked agent is the state you must act on), and
 * "done" only means finished-and-unread, which is why it stops being reported
 * once the session is opened.
 */
import clsx from 'clsx';
import type { ReactNode } from 'react';
import { useBarSession } from '../bar-context.ts';
import css from '../bar.module.css';
import { BarEntry } from '../chrome.tsx';
import type { BarLocaleKey } from '../locales.ts';

type StateTone = 'running' | 'waiting' | 'done' | 'idle';

const STATE_LABEL: Record<StateTone, BarLocaleKey> = {
  running: 'stateRunning',
  waiting: 'stateWaiting',
  done: 'stateDone',
  idle: 'stateIdle',
};

const STATE_DOT: Record<StateTone, string | undefined> = {
  running: css.dotRunning,
  waiting: css.dotWaiting,
  done: css.dotDone,
  idle: undefined,
};

export function BarStateItem(): ReactNode {
  const { session, t } = useBarSession();
  if (session === undefined) return null;

  const tone: StateTone =
    session.pendingInteraction !== undefined
      ? 'waiting'
      : session.running
        ? 'running'
        : session.completed === true
          ? 'done'
          : 'idle';

  const label = t(STATE_LABEL[tone]);
  // A subagent's row is worth marking: its state belongs to work the user did
  // not start directly, and the tooltip is the only place to say so.
  const title = session.origin === 'subagent' ? `${t('subagent')} · ${label}` : label;

  // No value beside the label: here the label *is* the reading. Under a narrow
  // column it hides and the dot carries the state alone, which is the one entry
  // where that degradation is still fully legible.
  return (
    <BarEntry
      icon={<span className={clsx(css.dot, STATE_DOT[tone])} />}
      label={label}
      title={title}
    />
  );
}
