import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import {
  FolderOpen,
  GitBranch,
  Loader2,
  MessageSquare,
  MessagesSquare,
  Search,
  Zap,
} from 'lucide-react';
import React, { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SearchItem } from '@shared/search';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import {
  getTaskManagerStore,
  getTaskStore,
  getTaskView,
} from '@renderer/features/tasks/stores/task-selectors';
import { commandRegistry } from '@renderer/lib/commands/registry';
import { useMobxValue } from '@renderer/lib/hooks/use-mobx-value';
import { APP_SHORTCUTS } from '@renderer/lib/hooks/useKeyboardShortcuts';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { cn } from '@renderer/utils/utils';
import { InfiniteGroup } from './infinite-group';
import { LovcodeInstallBanner } from './lovcode-install-banner';
import { parseQuery, setScope, type SearchScope } from './qualifiers';
import { applyContextAffinity, rrf } from './rrf';
import { useLovcodeSearch } from './use-lovcode-search';
import { useScopedSearch } from './use-scoped-search';

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

/**
 * Filters actions by the typed query before they enter RRF. Without this, the
 * full unfiltered action list gets fused by rank position and dominates results
 * regardless of what the user typed. Empty query returns all (for the Actions group).
 */
function filterActions(actions: PaletteAction[], text: string): PaletteAction[] {
  const q = text.trim().toLowerCase();
  if (!q) return actions;
  const terms = q.split(/\s+/);
  return actions.filter((a) => {
    const haystack = `${a.title} ${a.subtitle ?? ''}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
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
  const searchItem = item.kind !== 'action' ? (item as SearchItem) : null;
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 text-foreground-muted aria-selected:text-foreground rounded-md px-2 py-2 text-sm aria-selected:bg-background-2"
    >
      {KIND_ICON[item.kind]}
      <span className="flex-1 truncate">{item.title}</span>
      {searchItem?.archived && (
        <span className="shrink-0 rounded bg-background-quaternary px-1.5 py-0.5 text-[10px] text-foreground/50">
          Archived
        </span>
      )}
      {searchItem?.timestamp && (
        <RelativeTime
          value={searchItem.timestamp}
          compact
          className="shrink-0 text-xs text-foreground/40 tabular-nums"
        />
      )}
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
  const scope = parsed.scope;
  const inSessionsScope = scope === 'sessions';
  const inTasksScope = scope === 'tasks';
  const inProjectsScope = scope === 'projects';
  const inActionsScope = scope === 'actions';
  const searchText = parsed.text;

  const mounted = projectId ? asMounted(getProjectStore(projectId)) : undefined;
  const projectPath = mounted?.data.type === 'local' ? mounted.data.path : null;

  const { data: lovcodeResult, isFetching: lovcodeFetching } = useLovcodeSearch(
    projectId,
    projectPath,
    searchText,
    inSessionsScope
  );

  // The "all" recents overview is global across projects and tasks so every
  // category uses the same scope. Drop project/task context for empty-query
  // recents; typed search keeps them (project affinity + current-task convos).
  const isRecents = searchText.length === 0;
  const recentsProjectId = isRecents ? undefined : projectId;
  const recentsTaskId = isRecents ? undefined : taskId;

  const { data: dbResults = [] } = useQuery({
    queryKey: ['cmdk-search', searchText, recentsProjectId, recentsTaskId],
    queryFn: () =>
      rpc.search.commandPalette({
        query: searchText,
        context: { projectId: recentsProjectId, taskId: recentsTaskId },
      }),
    staleTime: 0,
    placeholderData: (prev) => prev,
    enabled: !inSessionsScope || searchText.length === 0,
  });

  // Scoped views (one chip selected) paginate a single kind with infinite scroll.
  // Recents are global (consistent with the "all" view); typed search keeps
  // project/task context.
  const scopedCtx = { projectId: recentsProjectId, taskId: recentsTaskId };
  const tasksPage = useScopedSearch('task', searchText, scopedCtx, inTasksScope);
  const projectsPage = useScopedSearch('project', searchText, scopedCtx, inProjectsScope);
  // Sessions always shows ALL conversations across tasks (never scoped to the
  // current task), regardless of where the palette was opened from.
  const sessionsPage = useScopedSearch(
    'conversation',
    searchText,
    { projectId: undefined, taskId: undefined },
    inSessionsScope && searchText.length === 0
  );

  const actions = useMobxValue((): PaletteAction[] =>
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
  const filteredActions = filterActions(actions, searchText);
  const merged = rrf<MergedResult>([rankedDb as MergedResult[], filteredActions as MergedResult[]]);

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

  const handleSetScope = (next: SearchScope) => {
    setQuery((prev) => setScope(prev, next));
  };

  const handleNavigateToTask = (item: SearchItem) => {
    if (!item.projectId) return;
    // Archived tasks are surfaced in search but must be restored before the
    // task view can mount them.
    if (item.archived) {
      void getTaskManagerStore(item.projectId)?.restoreTask(item.id);
    }
    onClose();
    navigate('task', { projectId: item.projectId, taskId: item.id });
  };

  const handleNavigateToProject = (item: SearchItem) => {
    onClose();
    navigate('project', { projectId: item.id });
  };

  const handleNavigateToConversation = (item: SearchItem) => {
    if (!item.projectId || !item.taskId) return;
    // The conversation may belong to an archived task; restore it first so the
    // task view can mount (mirrors handleNavigateToTask).
    if (item.archived) {
      void getTaskManagerStore(item.projectId)?.restoreTask(item.taskId);
    }
    getTaskView(item.projectId, item.taskId)?.tabManager.openConversation(item.id);
    onClose();
    navigate('task', { projectId: item.projectId, taskId: item.taskId });
  };

  const sessionsChipDisabled = !projectId || !projectPath;

  const scopeOptions: {
    value: SearchScope;
    label: string;
    title: string;
    icon: React.ReactNode;
    disabled?: boolean;
  }[] = [
    {
      value: 'all',
      label: t('commandPalette.scopeAll'),
      title: t('commandPalette.scopeAll'),
      icon: <Search className="size-3" />,
    },
    {
      value: 'actions',
      label: t('commandPalette.inActions'),
      title: t('commandPalette.actionsToggleTitle'),
      icon: <Zap className="size-3" />,
    },
    {
      value: 'projects',
      label: t('commandPalette.inProjects'),
      title: t('commandPalette.projectsToggleTitle'),
      icon: <FolderOpen className="size-3" />,
    },
    {
      value: 'tasks',
      label: t('commandPalette.inTasks'),
      title: t('commandPalette.tasksToggleTitle'),
      icon: <GitBranch className="size-3" />,
    },
    {
      value: 'sessions',
      label: t('commandPalette.inSessions'),
      title: sessionsChipDisabled
        ? t('commandPalette.sessionsRequiresProject')
        : t('commandPalette.sessionsToggleTitle'),
      icon:
        inSessionsScope && lovcodeFetching ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <MessagesSquare className="size-3" />
        ),
      disabled: sessionsChipDisabled,
    },
  ];

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
        {scopeOptions.map((opt) => {
          const active = scope === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleSetScope(opt.value)}
              disabled={opt.disabled}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors',
                active
                  ? 'border-foreground/30 bg-background-2 text-foreground'
                  : 'border-foreground/10 text-foreground/60 hover:text-foreground',
                opt.disabled && 'opacity-40 cursor-not-allowed hover:text-foreground/60'
              )}
              title={opt.title}
            >
              {opt.icon}
              {opt.label}
            </button>
          );
        })}
      </div>
      <Command.List className="h-96 overflow-y-auto p-1">
        {inSessionsScope ? (
          searchText.length === 0 ? (
            // No text yet: show recent conversations (SQLite index, paginated).
            // Typing switches to Lovcode transcript full-text search below.
            sessionsPage.items.length > 0 ? (
              <InfiniteGroup
                heading="Conversations"
                className={GROUP_CLASS}
                items={sessionsPage.items}
                hasNextPage={sessionsPage.hasNextPage}
                isFetchingNextPage={sessionsPage.isFetchingNextPage}
                fetchNextPage={sessionsPage.fetchNextPage}
                renderItem={(item) => (
                  <PaletteItem
                    key={item.id}
                    value={item.id}
                    item={item}
                    onSelect={() => handleNavigateToConversation(item)}
                  />
                )}
              />
            ) : (
              <div className="py-8 text-center text-xs text-foreground/40">
                {t('commandPalette.sessionsEmptyHint')}
              </div>
            )
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
        ) : inTasksScope ? (
          <>
            <Command.Empty className="py-8 text-center text-sm text-foreground/40">
              {t('commandPalette.noResultsFor', { query: searchText })}
            </Command.Empty>
            <InfiniteGroup
              heading="Tasks"
              className={GROUP_CLASS}
              items={tasksPage.items}
              hasNextPage={tasksPage.hasNextPage}
              isFetchingNextPage={tasksPage.isFetchingNextPage}
              fetchNextPage={tasksPage.fetchNextPage}
              renderItem={(item) => (
                <PaletteItem
                  key={item.id}
                  value={item.id}
                  item={item}
                  onSelect={() => handleNavigateToTask(item)}
                />
              )}
            />
          </>
        ) : inProjectsScope ? (
          <>
            <Command.Empty className="py-8 text-center text-sm text-foreground/40">
              {t('commandPalette.noResultsFor', { query: searchText })}
            </Command.Empty>
            <InfiniteGroup
              heading="Projects"
              className={GROUP_CLASS}
              items={projectsPage.items}
              hasNextPage={projectsPage.hasNextPage}
              isFetchingNextPage={projectsPage.isFetchingNextPage}
              fetchNextPage={projectsPage.fetchNextPage}
              renderItem={(item) => (
                <PaletteItem
                  key={item.id}
                  value={item.id}
                  item={item}
                  onSelect={() => handleNavigateToProject(item)}
                />
              )}
            />
          </>
        ) : inActionsScope ? (
          <>
            <Command.Empty className="py-8 text-center text-sm text-foreground/40">
              {t('commandPalette.noResultsFor', { query: searchText })}
            </Command.Empty>
            {actionResults.length > 0 && (
              <Command.Group heading="Actions" className={GROUP_CLASS}>
                {actionResults.map((item) => (
                  <PaletteItem key={item.id} value={item.id} item={item} onSelect={item.execute} />
                ))}
              </Command.Group>
            )}
          </>
        ) : searchText ? (
          <>
            <Command.Empty className="py-8 text-center text-sm text-foreground/40">
              {t('commandPalette.noResultsFor', { query: searchText })}
            </Command.Empty>
            {actionResults.length > 0 && (
              <Command.Group heading="Actions" className={GROUP_CLASS}>
                {actionResults.map((item) => (
                  <PaletteItem key={item.id} value={item.id} item={item} onSelect={item.execute} />
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
            {conversationResults.length > 0 && (
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
        ) : (
          <>
            {actionResults.length > 0 && (
              <Command.Group heading="Actions" className={GROUP_CLASS}>
                {actionResults.map((item) => (
                  <PaletteItem key={item.id} value={item.id} item={item} onSelect={item.execute} />
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
            {conversationResults.length > 0 && (
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
