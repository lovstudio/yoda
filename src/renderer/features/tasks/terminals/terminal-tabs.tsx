import { CircleFadingArrowUp, CirclePlayIcon } from 'lucide-react';
import React from 'react';
import { type ScriptType } from '@renderer/features/tasks/stores/lifecycle-scripts';
import { getPaneContainer } from '@renderer/lib/pty/pane-sizing-context';
import {
  DEFAULT_XTERM_SCROLLBAR_WIDTH,
  measureDimensions,
  TERMINAL_FIT_GUARD_COLUMNS,
} from '@renderer/lib/pty/pty-dimensions';

export function getTerminalsPaneSize(paneId = 'terminal-drawer') {
  const container = getPaneContainer(paneId);
  return container
    ? (measureDimensions(
        container,
        8,
        16,
        DEFAULT_XTERM_SCROLLBAR_WIDTH,
        TERMINAL_FIT_GUARD_COLUMNS
      ) ?? undefined)
    : undefined;
}

export function nextTerminalName(names: string[]): string {
  const taken = new Set(
    names
      .map((n) => /^Terminal (\d+)$/.exec(n)?.[1])
      .filter(Boolean)
      .map(Number)
  );
  let n = 1;
  while (taken.has(n)) n++;
  return `Terminal ${n}`;
}

export function scriptIcon(type: ScriptType): React.ReactNode {
  if (type === 'setup') return <CircleFadingArrowUp className="size-3.5" />;
  if (type === 'run') return <CirclePlayIcon className="size-3.5" />;
  return <CircleFadingArrowUp className="size-3.5 rotate-180" />;
}
