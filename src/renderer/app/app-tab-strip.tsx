import {
  Archive,
  BookText,
  Bot,
  ChartColumn,
  Cloud,
  Cpu,
  FileText,
  FlaskConical,
  GitCompare,
  House,
  LayoutDashboard,
  ListTodo,
  Loader2,
  MessageSquare,
  Milestone,
  Plus,
  Puzzle,
  Server,
  Settings,
  Smartphone,
  SquareKanban,
  Terminal,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskWindowTabTarget } from '@shared/task-window';
import { AppTabContextMenu } from '@renderer/app/app-tab-context-menu';
import { closeTaskTopTab, moveDraggedTabToStrip } from '@renderer/app/open-task-target';
import {
  tabDragSource,
  useTabDropZone,
  type TabDragPayload,
  type TabDragSourceProps,
} from '@renderer/app/tab-drag';
import type { ViewId } from '@renderer/app/view-registry';
import {
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { archiveConversationFlow } from '@renderer/features/tasks/archive-task';
import { AgentStatusIndicator } from '@renderer/features/tasks/components/agent-status-indicator';
import { formatConversationTitleForDisplay } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import {
  isIndexTab,
  PROJECT_PAGE_VIEWS,
  type AppTabEntry,
  type ProjectPageView,
} from '@renderer/lib/stores/app-tabs-store';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { agentConfig } from '@renderer/utils/agentConfig';
import { log } from '@renderer/utils/logger';
import { cn } from '@renderer/utils/utils';

/**
 * Icons for global views (task/project/file tabs derive theirs in describeTab).
 * Keep in sync with the sidebar nav items in features/sidebar/left-sidebar.tsx.
 */
const VIEW_ICONS: Partial<Record<ViewId, LucideIcon>> = {
  aiLab: FlaskConical,
  settings: Settings,
  skills: Puzzle,
  mcp: Server,
  agentManager: Bot,
  agents: Terminal,
  automation: Workflow,
  mobile: Smartphone,
  maas: Cloud,
  usage: ChartColumn,
  roadmap: Milestone,
  kanban: SquareKanban,
};

/**
 * Top-level tab strip — scoped to the active task/project context (IDE model).
 * Lives inside the titlebar row; shows the scope's index tab first, then its
 * sessions/files. Switching task or project swaps the whole set; other scopes'
 * tabs stay alive in the store. Each chip opts out of the window drag region
 * while the blank space around them stays draggable.
 */
export const AppTabStrip = observer(function AppTabStrip() {
  const { t } = useTranslation();
  const { visibleTabs, activeTabId } = appState.appTabs;
  const { navigate } = useNavigate();
  const showNewConversationModal = useShowModal('newConversationModal');

  // The strip is scope-isolated, so the first task/project tab carries the
  // active scope's identity.
  const scopeParams = visibleTabs.find((tab) => tab.viewId === 'task' || tab.viewId === 'project')
    ?.params as { projectId?: string; taskId?: string } | undefined;
  const projectId = typeof scopeParams?.projectId === 'string' ? scopeParams.projectId : undefined;
  const taskId = typeof scopeParams?.taskId === 'string' ? scopeParams.taskId : undefined;
  const provisionedTask =
    projectId && taskId ? asProvisioned(getTaskStore(projectId, taskId)) : undefined;

  // Inside a task, the strip's "+" creates another conversation in that task.
  // Elsewhere, go to the home draft page for creating a new task.
  const handleNewSession = () => {
    if (projectId && taskId) {
      if (!provisionedTask) return;
      showNewConversationModal({
        projectId,
        taskId,
        onSuccess: ({ conversationIds }) => {
          const conversationId = conversationIds[0];
          if (conversationId) provisionedTask.taskView.tabManager.openConversation(conversationId);
          provisionedTask.taskView.setFocusedRegion('main');
        },
      });
      return;
    }
    navigate('home', projectId ? { projectId } : undefined);
  };
  const newSessionLabel = taskId ? t('tasks.tabs.newConversation') : t('sidebar.newTask');
  const newSessionDisabled = Boolean(taskId && !provisionedTask);

  // Dropping a pinned entity or shell pin on the strip moves/reopens it here
  // and shows it — same meaning as dropping on the central column.
  const dropZone = useTabDropZone({
    canDrop: (payload) =>
      (payload.kind === 'task-entity' && payload.from !== 'strip') || payload.kind === 'shell-pin',
    onDrop: moveDraggedTabToStrip,
  });

  // On the home scope with nothing pinned, the strip would only carry the
  // home tab itself and a "+" that no-ops (navigate('home') from home). Hide
  // the whole row — HomeComposer already owns task creation.
  if (visibleTabs.length === 1 && visibleTabs[0]?.viewId === 'home') return null;

  return (
    <div
      ref={dropZone.dropRef}
      className={cn(
        'flex items-center gap-1 overflow-x-auto rounded-md',
        dropZone.isOver && 'bg-background-tertiary-1'
      )}
    >
      {visibleTabs.map((tab) => {
        const dismiss = describeDismiss(tab, t);
        return (
          <AppTabContextMenu key={tab.id} tab={tab}>
            <AppTab
              tab={tab}
              isActive={tab.id === activeTabId}
              // Sticky tabs are closeable even when index-kind: closing just
              // un-sticks them from the strip.
              closeable={!isIndexTab(tab) || appState.appTabs.isSticky(tab.id)}
              closeLabel={dismiss.label}
              closeIcon={dismiss.icon}
              closePending={dismiss.pending}
              onSelect={() => appState.appTabs.activateTab(tab.id)}
              onClose={dismiss.onDismiss}
              drag={tabDragSource(() => stripDragPayload(tab))}
            />
          </AppTabContextMenu>
        );
      })}
      {projectId && !taskId ? (
        <ProjectAddMenu projectId={projectId} newTaskLabel={newSessionLabel} />
      ) : (
        <button
          type="button"
          aria-label={newSessionLabel}
          title={newSessionLabel}
          disabled={newSessionDisabled}
          // Follows the tabs normally; once the strip overflows it pins to the
          // scrollport's right edge and tabs scroll beneath it.
          className={PLUS_BUTTON_CLASS}
          onClick={handleNewSession}
        >
          <Plus className="size-3.5" />
        </button>
      )}
    </div>
  );
});

const PLUS_BUTTON_CLASS =
  'sticky right-0 z-10 flex size-7 shrink-0 items-center justify-center rounded-md bg-background-secondary text-foreground-passive hover:bg-background-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-50 dark:bg-background [-webkit-app-region:no-drag]';

/**
 * The strip's "+" in a project scope: a menu that opens the project's
 * non-overview pages (tasks/sessions/harness/docs/settings) as tabs, plus a
 * shortcut to start a new task. Overview is the fixed tab and pages already
 * open are omitted. Docs is always offered — opening it unconfigured lands on
 * the Docs page's empty state, which guides the user to configure a source.
 */
const ProjectAddMenu = observer(function ProjectAddMenu({
  projectId,
  newTaskLabel,
}: {
  projectId: string;
  newTaskLabel: string;
}) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();

  const openViews = new Set(
    appState.appTabs.visibleTabs
      .filter((tab) => tab.viewId === 'project')
      .map((tab) => (tab.params.view as string | undefined) ?? 'overview')
  );

  const candidates = PROJECT_PAGE_VIEWS.filter(
    (view) => view !== 'overview' && !openViews.has(view)
  );

  const addPageLabel = t('appTabs.addProjectPage');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={addPageLabel}
            title={addPageLabel}
            className={PLUS_BUTTON_CLASS}
          >
            <Plus className="size-3.5" />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-52">
        {candidates.map((view) => {
          const { label, icon } = describeProjectTab(
            { id: '', viewId: 'project', params: { projectId, view } },
            t
          );
          return (
            <DropdownMenuItem
              key={view}
              onClick={() => appState.appTabs.openTab('project', { projectId, view })}
            >
              {icon}
              {label}
            </DropdownMenuItem>
          );
        })}
        {candidates.length > 0 ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem onClick={() => navigate('home', { projectId })}>
          <Plus className="size-4" />
          {newTaskLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

/**
 * Drag payload for a top-level tab: task entities move across areas; every
 * other tab (views, project pages, the task overview index) copy-pins into
 * the shell pane on drop.
 */
function stripDragPayload(tab: AppTabEntry): TabDragPayload {
  if (tab.viewId === 'task') {
    const { projectId, taskId } = tab.params as { projectId?: string; taskId?: string };
    const target = (tab.params.tab as TaskWindowTabTarget | undefined) ?? { kind: 'overview' };
    if (projectId && taskId && target.kind !== 'overview') {
      return { kind: 'task-entity', from: 'strip', projectId, taskId, target, appTab: tab };
    }
  }
  return { kind: 'view', from: 'strip', appTab: tab };
}

/**
 * Per-tab dismiss behavior for the × slot. Session tabs dismiss by archiving
 * (mirroring the task's archive button — the pre-archive command runs, and the
 * session leaves the strip for good); every other tab plainly closes. The
 * plain-close path for session tabs stays available via the context menu.
 */
function describeDismiss(
  tab: AppTabEntry,
  t: (key: string) => string
): { label: string; icon?: ReactNode; pending: boolean; onDismiss: () => void } {
  const { projectId, taskId } = tab.params as { projectId?: string; taskId?: string };
  const target = tab.params.tab as TaskWindowTabTarget | undefined;
  if (tab.viewId === 'task' && projectId && taskId && target?.kind === 'conversation') {
    const { conversationId } = target;
    const isArchiving =
      asProvisioned(getTaskStore(projectId, taskId))?.conversations.conversations.get(
        conversationId
      )?.isArchiving ?? false;
    return {
      label: t('tasks.tabs.archiveConversation'),
      icon: isArchiving ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Archive className="size-3" />
      ),
      pending: isArchiving,
      onDismiss: () => {
        void archiveConversationFlow(projectId, taskId, conversationId).catch((error: unknown) => {
          log.warn('AppTabStrip: archive conversation failed', {
            projectId,
            taskId,
            conversationId,
            error,
          });
        });
      },
    };
  }
  return { label: t('appTabs.closeTab'), pending: false, onDismiss: () => closeTaskTopTab(tab) };
}

const AppTab = observer(function AppTab({
  tab,
  isActive,
  closeable,
  closeLabel,
  closeIcon,
  closePending = false,
  onSelect,
  onClose,
  drag,
}: {
  tab: AppTabEntry;
  isActive: boolean;
  closeable: boolean;
  closeLabel: string;
  closeIcon?: ReactNode;
  closePending?: boolean;
  onSelect: () => void;
  onClose: () => void;
  drag?: TabDragSourceProps;
}) {
  const { t } = useTranslation();
  // Branch prefix is display noise on the index tab ("yoda / yoda/feat-x" →
  // "yoda / feat-x"), so describeTab strips it from branch labels.
  const { value: projectSettings } = useAppSettingsKey('project');
  const { label, icon } = describeTab(tab, t, projectSettings?.branchPrefix ?? '');

  return (
    <div
      role="tab"
      aria-selected={isActive}
      tabIndex={0}
      title={label}
      {...drag}
      className={cn(
        'group flex h-7 max-w-44 min-w-0 cursor-default select-none items-center gap-1.5 rounded-md border border-transparent py-1 px-2 text-xs [-webkit-app-region:no-drag]',
        isActive
          ? 'border-border bg-background-1 text-foreground'
          : 'text-foreground-muted hover:bg-background-2 hover:text-foreground'
      )}
      onClick={onSelect}
      onAuxClick={(event) => {
        if (event.button === 1 && closeable) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelect();
      }}
    >
      {/* One leading slot: the icon morphs into the close action on hover —
          or persistently while dismissal is pending (e.g. a session archiving
          through its pre-archive command) — so tabs never spend an extra slot
          on a trailing ×. */}
      <span className="relative flex size-4 shrink-0 items-center justify-center">
        <span
          className={cn(
            'flex items-center justify-center',
            closeable && 'group-hover:invisible',
            closePending && 'invisible'
          )}
        >
          {icon}
        </span>
        {closeable ? (
          <button
            type="button"
            aria-label={closeLabel}
            title={closeLabel}
            disabled={closePending}
            className={cn(
              'absolute inset-0 items-center justify-center rounded-sm text-foreground-passive hover:bg-background-2 hover:text-foreground',
              closePending ? 'flex' : 'hidden group-hover:flex'
            )}
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            {closeIcon ?? <X className="size-3" />}
          </button>
        ) : null}
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </div>
  );
});

function lucideIcon(Icon: LucideIcon): ReactNode {
  return <Icon className="size-3.5" />;
}

/** Label + icon for any top-level tab entry. Shared with the shell side pane's chips. */
export function describeTab(
  tab: AppTabEntry,
  t: (key: string) => string,
  branchPrefix: string
): { label: string; icon: ReactNode } {
  switch (tab.viewId) {
    case 'home':
      return { label: t('appTabs.home'), icon: lucideIcon(House) };
    case 'project':
      return describeProjectTab(tab, t);
    case 'task':
      return describeTaskTab(tab, t, branchPrefix);
    case 'file': {
      const filePath = tab.params.filePath;
      if (typeof filePath === 'string') {
        const filename = basename(filePath);
        return { label: filename, icon: <FileIcon filename={filename} size={13} /> };
      }
      return { label: t('appTabs.file'), icon: lucideIcon(FileText) };
    }
    case 'skill': {
      const { skillId, displayName } = tab.params as { skillId?: string; displayName?: string };
      return { label: displayName ?? skillId ?? t('sidebar.skills'), icon: lucideIcon(Puzzle) };
    }
    default:
      // Global views reuse the sidebar nav labels so the tab always matches
      // the nav item that opened it.
      return {
        label: t(`sidebar.${tab.viewId}`),
        icon: lucideIcon(VIEW_ICONS[tab.viewId] ?? FileText),
      };
  }
}

/** Project page tabs mirror the former in-panel ToggleGroup (same i18n keys). */
function describeProjectTab(
  tab: AppTabEntry,
  t: (key: string) => string
): { label: string; icon: ReactNode } {
  const view = ((tab.params.view as string | undefined) ?? 'overview') as ProjectPageView;
  switch (view) {
    case 'tasks':
      return { label: t('projects.sessions'), icon: lucideIcon(ListTodo) };
    case 'sessions':
      return { label: t('tasks.conversations.sessions'), icon: lucideIcon(MessageSquare) };
    case 'harness':
      return { label: t('projects.harness.label'), icon: lucideIcon(Cpu) };
    case 'docs':
      return { label: t('projects.docs.label'), icon: lucideIcon(BookText) };
    case 'settings':
      return { label: t('common.settings'), icon: lucideIcon(Settings) };
    case 'overview':
    default:
      return { label: t('appTabs.overview'), icon: lucideIcon(LayoutDashboard) };
  }
}

function describeTaskTab(
  tab: AppTabEntry,
  t: (key: string) => string,
  branchPrefix: string
): { label: string; icon: ReactNode } {
  const { projectId, taskId } = tab.params as { projectId?: string; taskId?: string };
  const target = (tab.params.tab as TaskWindowTabTarget | undefined) ?? { kind: 'overview' };
  const taskStore =
    typeof projectId === 'string' && typeof taskId === 'string'
      ? getTaskStore(projectId, taskId)
      : undefined;

  switch (target.kind) {
    case 'overview': {
      // The index tab carries the scope's identity: "project / branch",
      // falling back to the task name for tasks without a worktree branch.
      const projectName =
        typeof projectId === 'string' ? projectDisplayName(getProjectStore(projectId)) : undefined;
      const branchName =
        asProvisioned(taskStore)?.workspace.git.branchName ??
        (taskStore && 'taskBranch' in taskStore.data ? taskStore.data.taskBranch : undefined);
      const displayBranch =
        branchPrefix && branchName?.startsWith(`${branchPrefix}/`)
          ? branchName.slice(branchPrefix.length + 1)
          : branchName;
      const label = [projectName, displayBranch ?? taskStore?.data.name]
        .filter(Boolean)
        .join(' / ');
      return { label: label || t('appTabs.overview'), icon: lucideIcon(LayoutDashboard) };
    }
    case 'conversation': {
      const provisioned = asProvisioned(taskStore);
      const conversation = provisioned?.conversations.conversations.get(target.conversationId);
      const data = conversation?.data;
      const config = data ? agentConfig[data.runtimeId] : undefined;
      const label = data
        ? formatConversationTitleForDisplay(data.runtimeId, data.title).trim() ||
          config?.name ||
          data.runtimeId
        : t('appTabs.task');
      // The session's run state takes over the icon slot while it has one
      // (working / awaiting-input / unread error/completed) — same indicator
      // as the conversations list — and falls back to the runtime logo.
      const status = conversation?.indicatorStatus ?? null;
      return {
        label,
        icon: status ? (
          <AgentStatusIndicator status={status} disableTooltip boxClassName="size-4" />
        ) : config ? (
          <AgentLogo
            logo={config.logo}
            alt={config.alt}
            isSvg={config.isSvg}
            invertInDark={config.invertInDark}
            className="size-3.5"
          />
        ) : (
          lucideIcon(MessageSquare)
        ),
      };
    }
    case 'file': {
      const filename = basename(target.path);
      return { label: filename, icon: <FileIcon filename={filename} size={13} /> };
    }
    case 'diff':
      return { label: basename(target.path), icon: lucideIcon(GitCompare) };
  }
}

function basename(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value;
}
