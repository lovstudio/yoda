import { Pause, Play, Plus, Terminal, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { tabDragSource, tabDropIndex, useTabDropZone } from '@renderer/app/tab-drag';
import { type LifecycleScriptsStore } from '@renderer/features/tasks/stores/lifecycle-scripts';
import { type TerminalTabViewStore } from '@renderer/features/tasks/terminals/terminal-tab-view-store';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { isImeComposing } from '@renderer/utils/ime';
import { cn } from '@renderer/utils/utils';
import { scriptIcon } from './terminal-tabs';

/**
 * Sidebar of the terminals drawer mode: the terminal list with a trailing
 * "new terminal" row. Drawer chrome lives in the BottomPanel strip.
 */
export const TerminalDrawerSidebar = observer(function TerminalDrawerSidebar({
  terminalTabView,
  activeTerminalId,
  onSelectTerminal,
  onRemoveTerminal,
  onRenameTerminal,
  onCreateTerminal,
  className,
}: {
  terminalTabView: TerminalTabViewStore;
  activeTerminalId: string | undefined;
  onSelectTerminal: (id: string) => void;
  onRemoveTerminal: (id: string) => void;
  onRenameTerminal: (id: string, name: string) => void;
  onCreateTerminal: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  // Terminal rows reorder by vertical drag within the list.
  const dropZone = useTabDropZone({
    canDrop: (payload) => payload.kind === 'terminal-item',
    onDrop: (payload, event) => {
      if (payload.kind !== 'terminal-item') return;
      const raw = tabDropIndex(event, 'terminal-item', 'y');
      const from = terminalTabView.tabOrder.indexOf(payload.terminalId);
      if (from === -1) return;
      terminalTabView.reorderTabs(from, raw > from ? raw - 1 : raw);
    },
  });
  return (
    <SidebarList className={className} dropRef={dropZone.dropRef} isDropOver={dropZone.isOver}>
      {terminalTabView.tabs.map((terminal) => (
        <SidebarRow
          key={terminal.data.id}
          icon={<Terminal className="size-3" />}
          label={terminal.data.name}
          isActive={activeTerminalId === terminal.data.id}
          onSelect={() => onSelectTerminal(terminal.data.id)}
          onRename={(name) => onRenameTerminal(terminal.data.id, name)}
          drag={tabDragSource(() => ({ kind: 'terminal-item', terminalId: terminal.data.id }))}
          dropMarker="terminal-item"
          action={
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    className="ml-1 shrink-0 flex items-center justify-center size-5 rounded opacity-0 group-hover:opacity-100 hover:bg-background text-foreground-muted hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveTerminal(terminal.data.id);
                    }}
                  >
                    <X className="size-3" />
                  </button>
                }
              />
              <TooltipContent>{t('tasks.terminals.closeTerminal')}</TooltipContent>
            </Tooltip>
          }
        />
      ))}
      <button
        type="button"
        className="flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-foreground-muted hover:bg-background-2 hover:text-foreground"
        onClick={onCreateTerminal}
      >
        <Plus className="size-3 shrink-0" />
        <span className="truncate">{t('tasks.terminals.newTerminal')}</span>
      </button>
    </SidebarList>
  );
});

/**
 * Sidebar of the scripts drawer mode: lifecycle scripts with run/stop and a
 * trailing "new script" row (scripts are defined in project settings, so the
 * row jumps there). Drawer chrome lives in the BottomPanel strip.
 */
export const ScriptsDrawerSidebar = observer(function ScriptsDrawerSidebar({
  lifecycleScriptsMgr,
  activeScriptId,
  onSelectScript,
  onRunScript,
  onStopScript,
  onCreateScript,
  className,
}: {
  lifecycleScriptsMgr: LifecycleScriptsStore | null;
  activeScriptId: string | undefined;
  onSelectScript: (id: string) => void;
  onRunScript: () => void;
  onStopScript: () => void;
  onCreateScript: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const scripts = lifecycleScriptsMgr?.tabs ?? [];

  return (
    <SidebarList className={className}>
      {scripts.map((script) => {
        const isActive = activeScriptId === script.data.id;
        return (
          <SidebarRow
            key={script.data.id}
            icon={scriptIcon(script.data.type)}
            label={script.data.label}
            isActive={isActive}
            onSelect={() => onSelectScript(script.data.id)}
            action={
              isActive ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        className="ml-1 shrink-0 flex items-center justify-center size-5 rounded hover:bg-background text-foreground-muted hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (script.isRunning) {
                            onStopScript();
                          } else {
                            onRunScript();
                          }
                        }}
                      >
                        {script.isRunning ? (
                          <Pause className="size-3" />
                        ) : (
                          <Play className="size-3" />
                        )}
                      </button>
                    }
                  />
                  <TooltipContent>
                    {script.isRunning ? t('common.stop') : t('common.run')}
                  </TooltipContent>
                </Tooltip>
              ) : null
            }
          />
        );
      })}
      <button
        type="button"
        className="flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-foreground-muted hover:bg-background-2 hover:text-foreground"
        title={t('tasks.terminals.configureInProjectSettings')}
        onClick={onCreateScript}
      >
        <Plus className="size-3 shrink-0" />
        <span className="truncate">{t('tasks.terminals.newScript')}</span>
      </button>
    </SidebarList>
  );
});

function SidebarList({
  className,
  children,
  dropRef,
  isDropOver,
}: {
  className?: string;
  children: ReactNode;
  /** Registers the list as a tab-drag drop zone (see app/tab-drag.ts). */
  dropRef?: (node: HTMLElement | null) => void;
  isDropOver?: boolean;
}) {
  return (
    <div
      ref={dropRef}
      className={cn(
        'flex flex-col overflow-y-auto text-sm',
        isDropOver && 'bg-background-tertiary-1',
        className
      )}
    >
      <div className="flex flex-col gap-0.5 p-2">{children}</div>
    </div>
  );
}

interface SidebarRowProps {
  icon?: ReactNode;
  label: string;
  isActive: boolean;
  onSelect: () => void;
  onRename?: (name: string) => void;
  action?: ReactNode;
  /** Drag-source props (see app/tab-drag.ts) — rows stay presentation-only. */
  drag?: Pick<React.HTMLAttributes<HTMLDivElement>, 'onMouseDown'>;
  /** Marks the row for drop-index math in its list's drop zone. */
  dropMarker?: string;
}

function SidebarRow({
  icon,
  label,
  isActive,
  onSelect,
  onRename,
  action,
  drag,
  dropMarker,
}: SidebarRowProps) {
  const [isEditing, setIsEditing] = useState(false);

  if (isEditing && onRename) {
    return (
      <div
        className={cn(
          'group flex items-center gap-1.5 px-3 py-1 rounded-md',
          isActive && 'bg-background-2'
        )}
      >
        {icon && <span className="shrink-0 text-foreground-muted">{icon}</span>}
        <InlineRenameInput
          initialValue={label}
          onConfirm={(name) => {
            setIsEditing(false);
            if (name && name !== label) onRename(name);
          }}
          onCancel={() => setIsEditing(false)}
        />
      </div>
    );
  }

  return (
    <div
      data-tab-drop-marker={dropMarker}
      {...drag}
      className={cn(
        'group flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-background-2 rounded-md',
        isActive && 'bg-background-2 text-foreground'
      )}
      onClick={onSelect}
      onDoubleClick={(e) => {
        if (!onRename) return;
        e.stopPropagation();
        setIsEditing(true);
      }}
    >
      <span
        className={cn(
          'flex items-center gap-1.5 min-w-0 truncate text-foreground-muted',
          isActive && 'text-foreground'
        )}
      >
        {icon && <span className="shrink-0">{icon}</span>}
        <span className="truncate">{label}</span>
      </span>
      {action}
    </div>
  );
}

function InlineRenameInput({
  initialValue,
  onConfirm,
  onCancel,
}: {
  initialValue: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      className="w-full bg-transparent outline-none text-sm border border-border px-1 py-0.5 rounded text-foreground"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onConfirm(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !isImeComposing(e)) onConfirm(value);
        if (e.key === 'Escape') onCancel();
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
