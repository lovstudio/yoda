/**
 * The session's working directory — the one fact a status bar owes a user who
 * is about to let an agent write files. Clicking hands the path to the Host
 * operating system, which is the only file-open funnel a browser plugin has.
 */
import { Folder } from 'lucide-react';
import type { ReactNode } from 'react';
import { useBarSession } from '../bar-context.ts';
import { BarEntry, BarValue } from '../chrome.tsx';

/**
 * The last segment of a filesystem path, for either separator. The bar shows
 * the leaf and keeps the absolute path in the tooltip: a truncated middle of a
 * long path identifies nothing.
 */
function leafOf(path: string): string {
  const segments = path.split(/[\\/]/).filter((segment) => segment !== '');
  return segments.at(-1) ?? path;
}

export function BarCwdItem(): ReactNode {
  const { session, t, openPath } = useBarSession();
  const cwd = session?.cwd;
  if (cwd === undefined || cwd === '') return null;

  return (
    <BarEntry
      icon={<Folder />}
      label={t('directory')}
      title={`${cwd} · ${t('directoryOpen')}`}
      onClick={() => openPath(cwd)}
    >
      <BarValue>{leafOf(cwd)}</BarValue>
    </BarEntry>
  );
}
