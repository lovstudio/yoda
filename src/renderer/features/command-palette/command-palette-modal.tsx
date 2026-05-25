import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { FolderOpen, GitBranch, Loader2, MessageSquare, MessagesSquare, Zap } from 'lucide-react';
import { useObserver } from 'mobx-react-lite';
import React, { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SearchItem } from '@shared/search';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { getTaskStore, getTaskView } from '@renderer/features/tasks/stores/task-selectors';
import { commandRegistry } from '@renderer/lib/commands/registry';
import { APP_SHORTCUTS } from '@renderer/lib/hooks/useKeyboardShortcuts';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { cn } from '@renderer/utils/utils';
import { LovcodeInstallBanner } from './lovcode-install-banner';
import { parseQuery, toggleInSessionsQualifier } from './qualifiers';
import { applyContextAffinity, rrf } from './rrf';
import { useLovcodeSearch } from './use-lovcode-search';

interface CommandPaletteProps {
  projectId?: string;
  taskId?: string;
  initialQuery?: string;
}

interface PaletteAction {
  kind: 'action';
  id: string;
  title: string;
  subtitle?: string;
  shortcut?: string;
  score: number;
  execute: () => void;
}

type MergedResult = SearchItem | PaletteAction;

const KIND_ICON: Record<string, React.ReactNode> = {
  action: <Zap size={14} className="shrink-0 text-foreground/40" />,
  task: <GitBranch size={14} className="shrink-0 text-foreground/40" />,
  project: <FolderOpen size={14} className="shrink-0 text-foreground/40" />,
  conversation: <MessageSquare size={14} className="shrink-0 text-foreground/40" />,
};

const GROUP_CLASS = cn(
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5',
  '[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium',
  '[&_[cmdk-group-heading]]:text-foreground/50'
);

/** Converts a TanStack hotkey string (e.g. 'Mod+Shift+C') to a display label. */
function formatHotkey(hotkey: string | undefined): string | undefined {
  if (!hotkey) return undefined;
  return hotkey.replace('Mod', '⌘').replace('Shift', '⇧').replace('Alt', '⌥').replace(/\+/g, '');
}

function PaletteItem({
  value,
  item,
  onSelect,
}: {
  value: string;
  item: MergedResult;
  onSelect: () => void;
}) {
  const action = item.kind === 'action' ? (item as PaletteAction) : null;
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 text-foreground-muted aria-selected:text-foreground rounded-md px-2 py-2 text-sm aria-selected:bg-background-2"
    >
      {KIND_ICON[item.kind]}
      <span className="flex-1 truncate">{item.title}</span>
      {action?.shortcut && (
        <kbd className="shrink-0 rounded bg-background-quaternary px-1.5 py-0.5 text-xs text-foreground/60">
          {action.shortcut}
        </kbd>
      )}
    </Command.Item>
  );
}

export function CommandPaletteModal({
  projectId,
  taskId,
  initialQuery,
  onClose,
}: CommandPaletteProps & BaseModalProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(initialQuery ?? '');
  const deferred = useDeferredValue(query);
  const { navigate } = useNavigate();

  const parsed = parseQuery(deferred);
  const inSessionsScope = parsed.inSessions;
  const searchText = parsed.text;

  const mounted = projectId ? asMounted(getProjectStore(projectId)) : undefined;
  const projectPath = mounted?.data.type === 'local' ? mounted.data.path : null;

  const { data: lovcodeResult, isFetching: lovcodeFetching } = useLovcodeSearch(
    projectId,
    projectPath,
    searchText,
    inSessionsScope
  );

  const { data: dbResults = [] } = useQuery({
    queryKey: ['cmdk-search', searchText, projectId, taskId],
    queryFn: () => rpc.search.commandPalette({ query: searchText, context: { projectId, taskId } }),
    staleTime: 0,
    placeholderData: (prev) => prev,
    enabled: !inSessionsScope || searchText.length === 0,
  });

  const actions = useObserver((): PaletteAction[] =>
    commandRegistry.activeCommands
      .filter((cmd) => cmd.enabled !== false)
      .map((cmd) => ({
        kind: 'action' as const,
        id: cmd.id,
        title: cmd.label,
        subtitle: cmd.description,
        shortcut: cmd.shortcutKey
          ? formatHotkey(APP_SHORTCUTS[cmd.shortcutKey]?.defaultHotkey)
          : undefined,
        score: 0,
        execute: () => {
          onClose();
          cmd.execute();
        },
      }))
  );

  const rankedDb = applyContextAffinity(dbResults, { projectId });
  const merged = rrf<MergedResult>([rankedDb as MergedResult[], actions as MergedResult[]]);

  const actionResults = merged.filter((r): r is PaletteAction => r.kind === 'action');
  const taskResults = merged.filter((r): r is SearchItem => r.kind === 'task');
  const projectResults = merged.filter((r): r is SearchItem => r.kind === 'project');
  const conversationResults = merged.filter((r): r is SearchItem => r.kind === 'conversation');

  const lovcodeTaskItems: SearchItem[] =
    inSessionsScope && projectId && lovcodeResult?.status === 'ok'
      ? lovcodeResult.taskIds.flatMap((tid) => {
          const task = getTaskStore(projectId, tid)?.data;
          if (!task) return [];
          return [
            {
              kind: 'task' as const,
              id: tid,
              projectId,
              taskId: null,
              title: task.name,
              subtitle: '',
              score: 0,
            },
          ];
        })
      : [];
  const lovcodeNotInstalled =
    inSessionsScope && searchText.length > 0 && lovcodeResult?.status === 'not-installed';
  const lovcodeUnavailable = inSessionsScope && searchText.length > 0 && !projectPath;

  const handleToggleSessionsScope = () => {
    setQuery((prev) => toggleInSessionsQualifier(prev, !inSessionsScope));
  };

  const handleNavigateToTask = (item: SearchItem) => {
    if (!item.projectId) return;
    onClose();
    navigate('task', { projectId: item.projectId, taskId: item.id });
  };

  const handleNavigateToProject = (item: SearchItem) => {
    onClose();
    navigate('project', { projectId: item.id });
  };

  const handleNavigateToConversation = (item: SearchItem) => {
    if (!item.projectId || !item.taskId) return;
    getTaskView(item.projectId, item.taskId)?.tabManager.openConversation(item.id);
    onClose();
    navigate('task', { projectId: item.projectId, taskId: item.taskId });
  };

  const handleSelect = (item: MergedResult) => {
    if (item.kind === 'action') return (item as PaletteAction).execute();
    if (item.kind === 'task') return handleNavigateToTask(item as SearchItem);
    if (item.kind === 'project') return handleNavigateToProject(item as SearchItem);
    if (item.kind === 'conversation') return handleNavigateToConversation(item as SearchItem);
  };

  const sessionsChipDisabled = !projectId || !projectPath;

  return (
    <Command className="flex flex-col overflow-hidden" shouldFilter={false} loop>
      <div className="border-b border-foreground/10 px-1">
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder={t('commandPalette.placeholder')}
          className="w-full bg-transparent px-3 py-3 text-sm outline-none placeholder:text-foreground/40"
          autoFocus
        />
      </div>
      <div className="flex items-center gap-1.5 border-b border-foreground/10 px-3 py-1.5">
        <button
          type="button"
          onClick={handleToggleSessionsScope}
          disabled={sessionsChipDisabled}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors',
            inSessionsScope
              ? 'border-foreground/30 bg-background-2 text-foreground'
              : 'border-foreground/10 text-foreground/60 hover:text-foreground',
            sessionsChipDisabled && 'opacity-40 cursor-not-allowed hover:text-foreground/60'
          )}
          title={
            sessionsChipDisabled
              ? t('commandPalette.sessionsRequiresProject')
              : t('commandPalette.sessionsToggleTitle')
          }
        >
          {inSessionsScope && lovcodeFetching ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <MessagesSquare className="size-3" />
          )}
          {t('commandPalette.inSessions')}
        </button>
      </div>
      <Command.List className="h-96 overflow-y-auto p-1">
        {inSessionsScope ? (
          searchText.length === 0 ? (
            <div className="py-8 text-center text-xs text-foreground/40">
              {t('commandPalette.sessionsEmptyHint')}
            </div>
          ) : lovcodeUnavailable ? (
            <div className="py-8 text-center text-xs text-foreground/40">
              {t('commandPalette.sessionsRequiresProject')}
            </div>
          ) : lovcodeNotInstalled ? (
            <LovcodeInstallBanner />
          ) : (
            <>
              <Command.Empty className="py-8 text-center text-sm text-foreground/40">
                {lovcodeFetching
                  ? t('commandPalette.searchingTranscripts')
                  : t('commandPalette.noResultsFor', { query: searchText })}
              </Command.Empty>
              {lovcodeTaskItems.length > 0 && (
                <Command.Group heading={t('commandPalette.tasksSessions')} className={GROUP_CLASS}>
                  {lovcodeTaskItems.map((item) => (
                    <PaletteItem
                      key={`session-task:${item.id}`}
                      value={`session-task:${item.id}`}
                      item={item}
                      onSelect={() => handleNavigateToTask(item)}
                    />
                  ))}
                </Command.Group>
              )}
            </>
          )
        ) : query ? (
          <>
            <Command.Empty className="py-8 text-center text-sm text-foreground/40">
              {t('commandPalette.noResultsFor', { query })}
            </Command.Empty>
            {merged.map((item) => (
              <PaletteItem
                key={`${item.kind}:${item.id}`}
                value={`${item.kind}:${item.id}`}
                item={item}
                onSelect={() => handleSelect(item)}
              />
            ))}
          </>
        ) : (
          <>
            {actionResults.length > 0 && (
              <Command.Group heading="Actions" className={GROUP_CLASS}>
                {actionResults.map((item) => (
                  <PaletteItem key={item.id} value={item.id} item={item} onSelect={item.execute} />
                ))}
              </Command.Group>
            )}
            {taskResults.length > 0 && (
              <Command.Group heading="Tasks" className={GROUP_CLASS}>
                {taskResults.map((item) => (
                  <PaletteItem
                    key={item.id}
                    value={item.id}
                    item={item}
                    onSelect={() => handleNavigateToTask(item)}
                  />
                ))}
              </Command.Group>
            )}
            {projectResults.length > 0 && (
              <Command.Group heading="Projects" className={GROUP_CLASS}>
                {projectResults.map((item) => (
                  <PaletteItem
                    key={item.id}
                    value={item.id}
                    item={item}
                    onSelect={() => handleNavigateToProject(item)}
                  />
                ))}
              </Command.Group>
            )}
            {taskId && conversationResults.length > 0 && (
              <Command.Group heading="Conversations" className={GROUP_CLASS}>
                {conversationResults.map((item) => (
                  <PaletteItem
                    key={item.id}
                    value={item.id}
                    item={item}
                    onSelect={() => handleNavigateToConversation(item)}
                  />
                ))}
              </Command.Group>
            )}
          </>
        )}
      </Command.List>

      <div className="flex items-center gap-4 border-t border-foreground/10 px-3 py-2">
        <span className="flex items-center gap-1 text-xs text-foreground/40">
          <kbd className="rounded bg-background-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground/50">
            ↑
          </kbd>
          <kbd className="rounded bg-background-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground/50">
            ↓
          </kbd>
          Navigate
        </span>
        <span className="flex items-center gap-1 text-xs text-foreground/40">
          <kbd className="rounded bg-background-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground/50">
            ↵
          </kbd>
          Select
        </span>
        <span className="flex items-center gap-1 text-xs text-foreground/40">
          <kbd className="rounded bg-background-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground/50">
            Esc
          </kbd>
          Close
        </span>
      </div>
    </Command>
  );
}
