import { FolderGit2, Search } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@renderer/lib/ui/context-menu';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';

/** Show the filter field once the target list gets long enough to scan poorly. */
const SEARCH_THRESHOLD = 8;

interface MoveToProjectSubmenuProps {
  /** Project the task currently belongs to — excluded from the target list. */
  currentProjectId: string;
  /** Re-home the task under the chosen project. */
  onMove: (targetProjectId: string) => void;
}

interface MoveTarget {
  id: string;
  name: string;
}

/**
 * Registered projects other than the current one, in the same order they appear
 * in the sidebar (custom drag order + active workspace/type filters) so the
 * target list matches what the user is looking at.
 */
function useMoveTargets(currentProjectId: string): MoveTarget[] {
  return sidebarStore.orderedProjects
    .filter((p) => p.state !== 'unregistered' && p.data !== null && p.id !== currentProjectId)
    .map((p) => ({ id: p.id, name: p.displayName }));
}

function useFilteredTargets(currentProjectId: string) {
  const targets = useMoveTargets(currentProjectId);
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return targets;
    return targets.filter((t) => t.name.toLowerCase().includes(q));
  }, [targets, query]);
  return { showSearch: targets.length >= SEARCH_THRESHOLD, filtered, query, setQuery };
}

/**
 * Filter field for the project list inside the menu. A plain input (not a menu
 * item) that auto-focuses and swallows printable keystrokes so the menu's
 * built-in typeahead/navigation doesn't hijack typing.
 */
function ProjectSearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="px-1 pt-1 pb-0.5">
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-2 size-3.5 text-foreground-muted" />
        <input
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('tasks.context.moveToProjectSearch')}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            // Let the menu handle navigation/close keys; keep typing local so
            // the menu typeahead doesn't steal characters.
            if (['Escape', 'ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(e.key)) return;
            e.stopPropagation();
          }}
          className="h-7 w-full rounded-sm bg-background-2 pr-2 pl-7 text-sm outline-none placeholder:text-foreground-muted"
        />
      </div>
    </div>
  );
}

/** Context-menu variant of the "move to project" submenu. */
export const MoveToProjectContextSubmenu = observer(function MoveToProjectContextSubmenu({
  currentProjectId,
  onMove,
}: MoveToProjectSubmenuProps) {
  const { t } = useTranslation();
  const { showSearch, filtered, query, setQuery } = useFilteredTargets(currentProjectId);
  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger className="whitespace-nowrap">
          <FolderGit2 className="size-4" />
          {t('tasks.context.moveToProject')}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className={cn(showSearch && 'min-w-52')}>
          {showSearch && <ProjectSearchField value={query} onChange={setQuery} />}
          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <ContextMenuItem disabled>{t('tasks.context.moveToProjectEmpty')}</ContextMenuItem>
            ) : (
              filtered.map((target) => (
                <ContextMenuItem
                  key={target.id}
                  className="whitespace-nowrap"
                  onClick={() => onMove(target.id)}
                >
                  {target.name}
                </ContextMenuItem>
              ))
            )}
          </div>
        </ContextMenuSubContent>
      </ContextMenuSub>
    </>
  );
});

/** Dropdown-menu variant of {@link MoveToProjectContextSubmenu}. */
export const MoveToProjectDropdownSubmenu = observer(function MoveToProjectDropdownSubmenu({
  currentProjectId,
  onMove,
}: MoveToProjectSubmenuProps) {
  const { t } = useTranslation();
  const { showSearch, filtered, query, setQuery } = useFilteredTargets(currentProjectId);
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="whitespace-nowrap">
          <FolderGit2 className="size-4" />
          {t('tasks.context.moveToProject')}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className={cn(showSearch && 'min-w-52')}>
          {showSearch && <ProjectSearchField value={query} onChange={setQuery} />}
          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <DropdownMenuItem disabled>{t('tasks.context.moveToProjectEmpty')}</DropdownMenuItem>
            ) : (
              filtered.map((target) => (
                <DropdownMenuItem
                  key={target.id}
                  className="whitespace-nowrap"
                  onClick={() => onMove(target.id)}
                >
                  {target.name}
                </DropdownMenuItem>
              ))
            )}
          </div>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
});
