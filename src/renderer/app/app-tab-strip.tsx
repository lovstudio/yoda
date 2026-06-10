import {
  Bot,
  Cpu,
  FileText,
  GitCompare,
  House,
  LayoutDashboard,
  ListTodo,
  MessageSquare,
  Plus,
  Puzzle,
  Server,
  Settings,
  Smartphone,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskWindowTabTarget } from '@shared/task-window';
import { AppTabContextMenu } from '@renderer/app/app-tab-context-menu';
import { closeTaskTopTab } from '@renderer/app/open-task-target';
import type { ViewId } from '@renderer/app/view-registry';
import { formatConversationTitleForDisplay } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import {
  isIndexTab,
  type AppTabEntry,
  type ProjectPageView,
} from '@renderer/lib/stores/app-tabs-store';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';

/** Icons for global views (task/project/file tabs derive theirs in describeTab). */
const VIEW_ICONS: Partial<Record<ViewId, LucideIcon>> = {
  settings: Settings,
  skills: Puzzle,
  mcp: Server,
  agentManager: Bot,
  agents: Bot,
  automation: Workflow,
  mobile: Smartphone,
  maas: ListTodo,
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

  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {visibleTabs.map((tab) => (
        <AppTabContextMenu key={tab.id} tab={tab}>
          <AppTab
            tab={tab}
            isActive={tab.id === activeTabId}
            closeable={!isIndexTab(tab)}
            closeLabel={t('appTabs.closeTab')}
            onSelect={() => appState.appTabs.activateTab(tab.id)}
            onClose={() => closeTaskTopTab(tab)}
          />
        </AppTabContextMenu>
      ))}
      <button
        type="button"
        aria-label={newSessionLabel}
        title={newSessionLabel}
        disabled={newSessionDisabled}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-passive hover:bg-background-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-50 [-webkit-app-region:no-drag]"
        onClick={handleNewSession}
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
});

const AppTab = observer(function AppTab({
  tab,
  isActive,
  closeable,
  closeLabel,
  onSelect,
  onClose,
}: {
  tab: AppTabEntry;
  isActive: boolean;
  closeable: boolean;
  closeLabel: string;
  onSelect: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { label, icon } = describeTab(tab, t);

  return (
    <div
      role="tab"
      aria-selected={isActive}
      tabIndex={0}
      title={label}
      className={cn(
        'group flex h-7 max-w-44 min-w-0 cursor-default select-none items-center gap-1.5 rounded-md border border-transparent py-1 pl-2 pr-1 text-xs [-webkit-app-region:no-drag]',
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
      <span className="flex size-3.5 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
      {/* Constant-width close slot keeps every tab's structure identical;
          the button itself only appears on hover. */}
      <span className="flex size-4 shrink-0 items-center justify-center">
        {closeable ? (
          <button
            type="button"
            aria-label={closeLabel}
            title={closeLabel}
            className="invisible flex size-4 items-center justify-center rounded-sm text-foreground-passive hover:bg-background-2 hover:text-foreground group-hover:visible"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            <X className="size-3" />
          </button>
        ) : null}
      </span>
    </div>
  );
});

function lucideIcon(Icon: LucideIcon): ReactNode {
  return <Icon className="size-3.5" />;
}

function describeTab(
  tab: AppTabEntry,
  t: (key: string) => string
): { label: string; icon: ReactNode } {
  switch (tab.viewId) {
    case 'home':
      return { label: t('appTabs.home'), icon: lucideIcon(House) };
    case 'project':
      return describeProjectTab(tab, t);
    case 'task':
      return describeTaskTab(tab, t);
    case 'file': {
      const filePath = tab.params.filePath;
      if (typeof filePath === 'string') {
        const filename = basename(filePath);
        return { label: filename, icon: <FileIcon filename={filename} size={13} /> };
      }
      return { label: t('appTabs.file'), icon: lucideIcon(FileText) };
    }
    default:
      return {
        label: t(`appTabs.views.${tab.viewId}`),
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
    case 'settings':
      return { label: t('common.settings'), icon: lucideIcon(Settings) };
    case 'overview':
    default:
      return { label: t('appTabs.overview'), icon: lucideIcon(LayoutDashboard) };
  }
}

function describeTaskTab(
  tab: AppTabEntry,
  t: (key: string) => string
): { label: string; icon: ReactNode } {
  const { projectId, taskId } = tab.params as { projectId?: string; taskId?: string };
  const target = (tab.params.tab as TaskWindowTabTarget | undefined) ?? { kind: 'overview' };
  const taskStore =
    typeof projectId === 'string' && typeof taskId === 'string'
      ? getTaskStore(projectId, taskId)
      : undefined;

  switch (target.kind) {
    case 'overview':
      // The titlebar's left slot already shows project/task identity — the
      // index tab represents the task's overview page.
      return { label: t('appTabs.overview'), icon: lucideIcon(LayoutDashboard) };
    case 'conversation': {
      const provisioned = asProvisioned(taskStore);
      const data = provisioned?.conversations.conversations.get(target.conversationId)?.data;
      const config = data ? agentConfig[data.runtimeId] : undefined;
      const label = data
        ? formatConversationTitleForDisplay(data.runtimeId, data.title).trim() ||
          config?.name ||
          data.runtimeId
        : t('appTabs.task');
      return {
        label,
        icon: config ? (
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
