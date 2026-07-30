import { useQuery } from '@tanstack/react-query';
import {
  Eye,
  GitFork,
  ListFilter,
  Loader2,
  MessageSquareText,
  MoreHorizontal,
  ScanLine,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClaudeSessionPrompt, ProjectPromptSource } from '@shared/conversations';
import { displaySessionPromptText } from '@renderer/features/tasks/context-panel-prompt-display';
import { forkConversationAtPromptIntoNewTab } from '@renderer/features/tasks/conversations/use-conversation-prompt-restore';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { agentConfig } from '@renderer/utils/agentConfig';
import { log } from '@renderer/utils/logger';
import {
  openProjectSessionConversation,
  prepareProjectSessionConversation,
} from '../sessions-view/project-session-open';
import {
  buildProjectPromptEntries,
  compareProjectPromptEntries,
  insertProjectPromptEntries,
  type ProjectPromptEntry,
  type ProjectPromptSortOrder,
} from './project-prompt-items';

const PREVIEW_LIMIT = 5;
const SCAN_CONCURRENCY = 3;
const ALL_TASKS = '*';
const EMPTY_SOURCES: ProjectPromptSource[] = [];

type PromptAction = {
  id: 'view' | 'session' | 'fork';
  label: string;
  icon: ComponentType<{ className?: string }>;
  disabled?: boolean;
  run: () => void;
};

export const ProjectPromptsCard = observer(function ProjectPromptsCard({
  projectId,
}: {
  projectId: string;
}) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const showPrompt = useShowModal('sessionPromptsModal');
  const showForkConfirm = useShowModal('confirmActionModal');
  const [entries, setEntries] = useState<ProjectPromptEntry[]>([]);
  const [scannedSources, setScannedSources] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  const [taskFilter, setTaskFilter] = useState(ALL_TASKS);
  const [sortOrder, setSortOrder] = useState<ProjectPromptSortOrder>('newest');
  const [expanded, setExpanded] = useState(false);

  const {
    data: loadedSources,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['project-prompt-sources', projectId],
    queryFn: () => rpc.conversations.getProjectPromptSources(projectId),
    staleTime: 15_000,
    refetchOnMount: 'always',
  });
  const sources = loadedSources ?? EMPTY_SOURCES;

  useEffect(() => {
    let cancelled = false;
    const knownConversationIds = new Set(sources.map((source) => source.conversation.id));
    let nextSourceIndex = 0;

    setEntries([]);
    setScannedSources(0);
    setIsScanning(sources.length > 0);

    const scanNext = async () => {
      while (!cancelled) {
        const sourceOrder = nextSourceIndex;
        nextSourceIndex += 1;
        const source = sources[sourceOrder];
        if (!source) return;

        let prompts: ClaudeSessionPrompt[] = [];
        try {
          prompts = await rpc.conversations.getProjectConversationPrompts(
            projectId,
            source.conversation.id
          );
        } catch (scanError) {
          log.warn('ProjectPromptsCard: transcript scan failed', {
            conversationId: source.conversation.id,
            error: scanError,
          });
        }
        if (cancelled) return;

        const incoming = buildProjectPromptEntries(
          source,
          prompts,
          sourceOrder,
          knownConversationIds
        );
        setEntries((current) => insertProjectPromptEntries(current, incoming));
        setScannedSources((current) => current + 1);
      }
    };

    const workers = Array.from({ length: Math.min(SCAN_CONCURRENCY, sources.length) }, () =>
      scanNext()
    );
    void Promise.all(workers).then(() => {
      if (!cancelled) setIsScanning(false);
    });

    return () => {
      cancelled = true;
    };
  }, [projectId, sources]);

  const tasks = useMemo(() => {
    const unique = new Map<string, string>();
    for (const source of sources) {
      unique.set(source.conversation.taskId, source.taskName);
    }
    return [...unique.entries()].sort((left, right) => left[1].localeCompare(right[1]));
  }, [sources]);

  const filteredEntries = useMemo(() => {
    const filtered =
      taskFilter === ALL_TASKS ? entries : entries.filter((entry) => entry.taskId === taskFilter);
    return filtered
      .slice()
      .sort((left, right) => compareProjectPromptEntries(left, right, sortOrder));
  }, [entries, sortOrder, taskFilter]);
  const visibleEntries = expanded ? filteredEntries : filteredEntries.slice(0, PREVIEW_LIMIT);

  const openSession = (entry: ProjectPromptEntry) => {
    void openProjectSessionConversation(entry.conversation, navigate, {
      id: entry.prompt.id,
      index: entry.promptIndex,
    }).catch((openError: unknown) => {
      toast({
        title: t('projects.promptHistory.openSessionFailed'),
        description: openError instanceof Error ? openError.message : String(openError),
        variant: 'destructive',
        debugInfo: openError,
      });
    });
  };

  const executeFork = async (entry: ProjectPromptEntry) => {
    try {
      const provisioned = await prepareProjectSessionConversation(entry.conversation);
      if (!provisioned) throw new Error(t('projects.promptHistory.taskUnavailable'));
      const fork = await forkConversationAtPromptIntoNewTab(provisioned, {
        conversation: entry.conversation,
        prompt: entry.prompt,
        promptIndex: entry.promptIndex,
      });
      if (!fork) return;
      navigate('task', { projectId: entry.projectId, taskId: entry.taskId });
      toast({ title: t('tasks.sessionInfo.restoreContextSuccess') });
    } catch (forkError) {
      toast({
        title: t('tasks.sessionInfo.restoreContextFailed'),
        description: forkError instanceof Error ? forkError.message : String(forkError),
        variant: 'destructive',
        debugInfo: forkError,
      });
    }
  };

  const requestFork = (entry: ProjectPromptEntry) => {
    if (!entry.restoreTarget) return;
    showForkConfirm({
      title: t('tasks.sessionInfo.restoreContextTitle', { index: entry.promptIndex + 1 }),
      description: t('tasks.sessionInfo.restoreContextDescription'),
      confirmLabel: t('tasks.sessionInfo.restoreContextConfirm'),
      variant: 'default',
      onSuccess: () => void executeFork(entry),
    });
  };

  const viewPrompt = (entry: ProjectPromptEntry) => {
    showPrompt({
      prompts: [entry.prompt],
      promptNumbers: [entry.promptIndex + 1],
      sessionTitle: `${entry.conversationTitle} · ${entry.taskName}`,
      onRestorePrompt: entry.restoreTarget ? () => requestFork(entry) : undefined,
    });
  };

  const actionsFor = (entry: ProjectPromptEntry): PromptAction[] => [
    {
      id: 'view',
      label: t('projects.promptHistory.viewPrompt'),
      icon: Eye,
      run: () => viewPrompt(entry),
    },
    {
      id: 'session',
      label: t('projects.promptHistory.openSession'),
      icon: MessageSquareText,
      run: () => openSession(entry),
    },
    {
      id: 'fork',
      label: t('projects.promptHistory.forkFromPrompt'),
      icon: GitFork,
      disabled: !entry.restoreTarget,
      run: () => requestFork(entry),
    },
  ];

  return (
    <section className="@container rounded-lg border border-border bg-background-elevated p-4">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
            <MessageSquareText className="size-3.5" />
            {t('projects.promptHistory.title')}
          </h2>
          <p className="mt-1 text-xs text-foreground-muted">
            {isScanning
              ? t('projects.promptHistory.scanning', {
                  scanned: scannedSources,
                  total: sources.length,
                  count: entries.length,
                })
              : t('projects.promptHistory.loaded', { count: entries.length })}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Select value={taskFilter} onValueChange={(value) => setTaskFilter(value ?? ALL_TASKS)}>
            <SelectTrigger
              size="sm"
              className="max-w-52 text-xs"
              aria-label={t('projects.promptHistory.filterByTask')}
            >
              <ListFilter className="size-3.5" />
              <SelectValue>
                {(value: string | null) =>
                  value === ALL_TASKS
                    ? t('projects.promptHistory.allTasks')
                    : (tasks.find(([taskId]) => taskId === value)?.[1] ??
                      t('projects.promptHistory.allTasks'))
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value={ALL_TASKS} className="text-xs">
                {t('projects.promptHistory.allTasks')}
              </SelectItem>
              {tasks.map(([taskId, taskName]) => (
                <SelectItem key={taskId} value={taskId} className="text-xs">
                  <span className="truncate">{taskName}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={sortOrder}
            onValueChange={(value) => setSortOrder(value as ProjectPromptSortOrder)}
          >
            <SelectTrigger
              size="sm"
              className="text-xs"
              aria-label={t('projects.promptHistory.sort')}
            >
              <ScanLine className="size-3.5" />
              <SelectValue>
                {(value: string | null) =>
                  value === 'oldest'
                    ? t('projects.promptHistory.oldestFirst')
                    : t('projects.promptHistory.newestFirst')
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="newest" className="text-xs">
                {t('projects.promptHistory.newestFirst')}
              </SelectItem>
              <SelectItem value="oldest" className="text-xs">
                {t('projects.promptHistory.oldestFirst')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>

      {isLoading ? (
        <PromptCardMessage icon={<Loader2 className="size-3.5 animate-spin" />}>
          {t('common.loading')}
        </PromptCardMessage>
      ) : error ? (
        <PromptCardMessage>
          <span>{t('projects.promptHistory.loadFailed')}</span>
          <Button size="xs" variant="outline" onClick={() => void refetch()}>
            {t('usage.retry')}
          </Button>
        </PromptCardMessage>
      ) : visibleEntries.length === 0 ? (
        <PromptCardMessage
          icon={isScanning ? <Loader2 className="size-3.5 animate-spin" /> : undefined}
        >
          {isScanning
            ? t('projects.promptHistory.waitingForPrompts')
            : taskFilter === ALL_TASKS
              ? t('projects.promptHistory.empty')
              : t('projects.promptHistory.emptyTask')}
        </PromptCardMessage>
      ) : (
        <ol className="space-y-1">
          {visibleEntries.map((entry) => (
            <ProjectPromptRow
              key={entry.id}
              entry={entry}
              actions={actionsFor(entry)}
              onView={() => viewPrompt(entry)}
            />
          ))}
        </ol>
      )}

      {filteredEntries.length > PREVIEW_LIMIT ? (
        <div className="mt-2 flex justify-end border-t border-border pt-2">
          <Button variant="ghost" size="sm" onClick={() => setExpanded((current) => !current)}>
            {expanded
              ? t('projects.promptHistory.collapse')
              : t('projects.promptHistory.viewAll', { count: filteredEntries.length })}
          </Button>
        </div>
      ) : null}
    </section>
  );
});

function ProjectPromptRow({
  entry,
  actions,
  onView,
}: {
  entry: ProjectPromptEntry;
  actions: PromptAction[];
  onView: () => void;
}) {
  const displayText = displaySessionPromptText(entry.prompt.text);

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <li className="group flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-background-hover focus-within:bg-background-hover">
            <span className="w-7 shrink-0 text-right font-mono text-[10px] text-foreground-passive">
              #{entry.promptIndex + 1}
            </span>

            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    onClick={onView}
                  >
                    {displayText}
                  </button>
                }
              />
              <TooltipContent className="max-h-64 max-w-md overflow-auto whitespace-pre-wrap break-words">
                {displayText}
              </TooltipContent>
            </Tooltip>

            {entry.submittedAt ? (
              <span className="hidden min-w-12 shrink-0 justify-end text-[10px] text-foreground-passive @2xl:flex">
                <RelativeTime value={entry.submittedAt} compact />
              </span>
            ) : null}

            <PromptActionsDropdown entry={entry} actions={actions} />
          </li>
        }
      />
      <ContextMenuContent className="w-60">
        <PromptSessionMenuHeader entry={entry} />
        <ContextMenuSeparator />
        <PromptActionItems actions={actions} Item={ContextMenuItem} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function PromptActionsDropdown({
  entry,
  actions,
}: {
  entry: ProjectPromptEntry;
  actions: PromptAction[];
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="@xl:opacity-0 @xl:group-hover:opacity-100 @xl:group-focus-within:opacity-100"
            aria-label={t('common.more')}
            title={t('common.more')}
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-60">
        <PromptSessionMenuHeader entry={entry} />
        <DropdownMenuSeparator />
        <PromptActionItems actions={actions} Item={DropdownMenuItem} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PromptSessionMenuHeader({ entry }: { entry: ProjectPromptEntry }) {
  const config = agentConfig[entry.conversation.runtimeId];
  return (
    <div className="flex min-w-0 items-center gap-2 px-2 py-1.5" data-project-prompt-session>
      {config ? (
        <AgentLogo
          logo={config.logo}
          alt={config.alt}
          isSvg={config.isSvg}
          invertInDark={config.invertInDark}
          className="size-4 shrink-0"
        />
      ) : (
        <MessageSquareText className="size-4 shrink-0 text-foreground-muted" />
      )}
      <div className="min-w-0">
        <div
          className="truncate text-xs font-medium text-foreground"
          title={entry.conversationTitle}
        >
          {entry.conversationTitle}
        </div>
        <div className="truncate text-[11px] text-foreground-muted" title={entry.taskName}>
          {entry.taskName}
        </div>
      </div>
    </div>
  );
}

function PromptActionItems({
  actions,
  Item,
}: {
  actions: PromptAction[];
  Item: ComponentType<{
    children?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }>;
}) {
  return actions.map((action) => {
    const Icon = action.icon;
    return (
      <Item key={action.id} disabled={action.disabled} onClick={action.run}>
        <Icon className="size-3.5" />
        {action.label}
      </Item>
    );
  });
}

function PromptCardMessage({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 text-xs text-foreground-muted">
      {icon}
      {children}
    </div>
  );
}
