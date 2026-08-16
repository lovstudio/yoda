/**
 * Background jobs of this session. The entry exists only while some job is
 * running: a permanent "0" trains the eye to ignore the seat, and this is the
 * seat that matters when a `bash` job is still writing after the agent replied.
 */
import { ListTodo } from 'lucide-react';
import type { ReactNode } from 'react';
import { useBarSession } from '../bar-context.ts';
import { BarEntry, BarValue } from '../chrome.tsx';

/** How many job labels the tooltip names before it stops listing them. */
const TOOLTIP_JOB_LIMIT = 3;

export function BarJobsItem(): ReactNode {
  const { jobs, t } = useBarSession();
  const running = jobs.filter((job) => job.status === 'running');
  if (running.length === 0) return null;

  const named = running.slice(0, TOOLTIP_JOB_LIMIT).map((job) => `${job.kind}: ${job.label}`);
  const detail = t('jobsDetail', { running: running.length });

  return (
    <BarEntry icon={<ListTodo />} label={t('jobs')} title={[detail, ...named].join('\n')}>
      <BarValue>{running.length}</BarValue>
    </BarEntry>
  );
}
