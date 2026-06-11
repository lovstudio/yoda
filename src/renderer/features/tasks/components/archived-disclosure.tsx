import { Archive, ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@renderer/utils/utils';

/**
 * Collapsed-by-default "Archived (N)" reveal: archived items live at the
 * bottom of their active sibling list instead of a separate view. Shared by
 * the subtask list, the overview sessions section, and the sidebar
 * conversations list.
 */
export function ArchivedDisclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="-mx-1 flex items-center gap-1 self-start rounded px-1 py-0.5 text-xs text-foreground-passive transition-colors hover:text-foreground-muted"
      >
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        <Archive className="size-3" />
        <span>{label}</span>
      </button>
      {open && children}
    </div>
  );
}
