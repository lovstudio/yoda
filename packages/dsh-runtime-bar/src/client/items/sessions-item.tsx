/**
 * Workspace-wide session count, sitting in the tray at the right edge. This is
 * the one entry that is not about the session in front of you — it answers "is
 * something else of mine still working" without leaving the conversation.
 */
import { Layers } from 'lucide-react';
import type { ReactNode } from 'react';
import { useBarSession } from '../bar-context.ts';
import { BarEntry, BarValue } from '../chrome.tsx';

export function BarSessionsItem(): ReactNode {
  const { sessionCount, runningSessionCount, t } = useBarSession();
  if (sessionCount === 0) return null;

  return (
    <BarEntry
      icon={<Layers />}
      label={t('sessions')}
      title={t('sessionsDetail', { running: runningSessionCount, total: sessionCount })}
    >
      <BarValue>
        {runningSessionCount}/{sessionCount}
      </BarValue>
    </BarEntry>
  );
}
