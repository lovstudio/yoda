import React from 'react';
import { useTranslation } from 'react-i18next';
import type { MaasPlatformId } from '@shared/maas';
import type { RuntimeId } from '@shared/runtime-registry';
import { AgentManagerView } from '@renderer/features/agents-config/agent-manager-view';
import { RuntimeAccordion } from '@renderer/features/agents/components/RuntimeAccordion';
import { AiLogsPanel } from '@renderer/features/ai-logs/components/AiLogsPanel';
import { AutomationMainPanel } from '@renderer/features/automation/automation-view';
import { KanbanBoard } from '@renderer/features/kanban/components/KanbanBoard';
import { MaasView } from '@renderer/features/maas/components/MaasView';
import { McpView } from '@renderer/features/mcp/components/McpView';
import { MobileView } from '@renderer/features/mobile/mobile-view';
import { PromptLibraryPanel } from '@renderer/features/prompt-library/prompt-library-panel';
import { RoadmapView } from '@renderer/features/roadmap/components/RoadmapView';
import SkillsCatalogHint from '@renderer/features/skills/components/SkillsCatalogHint';
import SkillsView from '@renderer/features/skills/components/SkillsView';
import { UsageView } from '@renderer/features/usage/components/UsageView';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { SectionNavDropdown, type SectionNavGroup } from '@renderer/lib/ui/section-nav';
import { SectionPage } from '@renderer/lib/ui/section-page';
import { AccountTab } from './AccountTab';
import ArchivedProjectsCard from './ArchivedProjectsCard';
import { CliAgentsRescanButton } from './CliAgentsList';
import DefaultRuntimeSettingsCard from './DefaultRuntimeSettingsCard';
import GithubSettingsCard from './GithubSettingsCard';
import IntegrationsCard from './IntegrationsCard';
import KeyboardSettingsCard from './KeyboardSettingsCard';
import LanguageCard from './LanguageCard';
import {
  LlmProfileAssignmentsCard,
  LlmProfileDebugCard,
  LlmProfilesCard,
} from './LlmConfigDebugCard';
import ModelsSettingsCard, { ModelCatalogAutomaticUpdateSetting } from './ModelsSettingsCard';
import NotificationSettingsCard from './NotificationSettingsCard';
import OpenInAppsSettingsCard from './OpenInAppsSettingsCard';
import SessionAiSettingsCard from './SessionAiSettingsCard';
import SessionShareDisplayLevelSettingsRow from './SessionShareDisplayLevelSettingsRow';
import SidebarStatusBarSettingsRow from './SidebarStatusBarSettingsRow';
import TaskAppearanceSettingsCard from './TaskAppearanceSettingsCard';
import {
  AutoTrustWorktreesRow,
  BranchNamingRow,
  EnableTmuxRow,
  InitTaskNameFromSessionRow,
  PreArchiveCommandRow,
  TmuxSettingsChapter,
  WorkspacesEnabledRow,
} from './TaskSettingsRows';
import TelemetryCard from './TelemetryCard';
import TerminalSettingsCard from './TerminalSettingsCard';
import ThemeCard from './ThemeCard';
import { UpdateCard } from './UpdateCard';

export type SettingsPageTab =
  | 'general'
  | 'account'
  | 'clis-models'
  | 'models'
  | 'llm'
  | 'tasks'
  | 'sessions'
  | 'integrations'
  | 'open-in'
  | 'mcp'
  | 'prompts'
  | 'skills'
  | 'agent-manager'
  | 'maas'
  | 'usage'
  | 'ai-logs'
  | 'automation'
  | 'mobile'
  | 'repository'
  | 'interface'
  | 'terminal'
  | 'keyboard-shortcuts'
  | 'kanban'
  | 'roadmap';

interface SectionConfig {
  id: string;
  title?: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  surface?: 'panel' | 'plain';
  component: React.ReactNode;
}

interface TabContentConfig {
  title: string;
  titleHint?: React.ReactNode;
  description: string;
  component?: React.ReactNode;
  sections?: SectionConfig[];
}

/** Grouped tabs; groups are visually separated. Account leads the first group. */
function useSettingsTabGroups(): SectionNavGroup<SettingsPageTab>[] {
  const { t } = useTranslation();
  return [
    // Identity: account + its usage.
    {
      id: 'identity',
      items: [
        { id: 'account', label: t('settings.tabs.account') },
        { id: 'usage', label: t('settings.tabs.usage') },
        { id: 'ai-logs', label: t('settings.tabs.aiLogs') },
      ],
    },
    // App-wide preferences.
    {
      id: 'preferences',
      items: [
        { id: 'general', label: t('settings.tabs.general') },
        { id: 'interface', label: t('settings.tabs.interface') },
        { id: 'terminal', label: t('settings.tabs.terminal') },
        { id: 'keyboard-shortcuts', label: t('settings.tabs.keyboardShortcuts') },
      ],
    },
    // Projects, the tasks that run inside them, and the agent sessions inside tasks.
    {
      id: 'work',
      items: [
        { id: 'repository', label: t('settings.tabs.repository') },
        { id: 'tasks', label: t('settings.tabs.tasks') },
        { id: 'sessions', label: t('settings.tabs.sessions') },
      ],
    },
    // Agent execution config: runtimes and model access. Resource management
    // (prompts, skills, MCP, custom agents, automation) lives in the Library.
    {
      id: 'execution',
      items: [
        { id: 'models', label: t('settings.tabs.models') },
        { id: 'maas', label: t('settings.tabs.maas') },
        { id: 'clis-models', label: t('settings.tabs.agents') },
        { id: 'llm', label: t('settings.tabs.llm') },
      ],
    },
    // Product integrations and companion surfaces.
    {
      id: 'integrations',
      items: [
        { id: 'integrations', label: t('settings.tabs.integrations') },
        { id: 'open-in', label: t('settings.tabs.openIn') },
        { id: 'mobile', label: t('settings.tabs.mobile') },
      ],
    },
    // Early previews and outlook.
    {
      id: 'previews',
      items: [
        { id: 'kanban', label: t('settings.tabs.kanban'), badge: 'Alpha' },
        { id: 'roadmap', label: t('settings.tabs.roadmap') },
      ],
    },
  ];
}

/**
 * Compact tab picker for hosts without room for the nav column: the shell
 * side pane's chip-strip row (via the settings PaneHeaderSlot) and, as a
 * fallback, the content header in narrow main-area windows.
 */
export function SettingsTabsDropdown({
  tab: activeTab,
  onTabChange,
  className,
}: {
  tab: SettingsPageTab;
  onTabChange: (tab: SettingsPageTab) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const tabGroups = useSettingsTabGroups();
  return (
    <SectionNavDropdown
      groups={tabGroups}
      activeId={activeTab}
      onSelect={onTabChange}
      label={t('common.settings')}
      className={className}
    />
  );
}

export function SettingsPage({
  tab: activeTab,
  focusRuntimeId,
  focusMaasPlatformId,
  onTabChange,
}: {
  tab: SettingsPageTab;
  focusRuntimeId?: RuntimeId;
  focusMaasPlatformId?: MaasPlatformId;
  onTabChange: (tab: SettingsPageTab) => void;
}) {
  const { t } = useTranslation();
  const tabGroups = useSettingsTabGroups();
  const { navigate } = useNavigate();

  const tabContent: Record<string, TabContentConfig> = {
    general: {
      title: t('settings.tabs.general'),
      description: t('settings.general.description'),
      sections: [
        {
          id: 'language',
          component: <LanguageCard />,
        },
        {
          id: 'telemetry',
          component: <TelemetryCard />,
        },
        {
          id: 'update',
          component: <UpdateCard />,
        },
      ],
    },
    tasks: {
      title: t('settings.tabs.tasks'),
      description: t('settings.tasksTab.description'),
      sections: [
        {
          id: 'workspaces-enabled',
          component: <WorkspacesEnabledRow />,
        },
        {
          id: 'init-task-name-from-session',
          component: <InitTaskNameFromSessionRow />,
        },
        {
          id: 'branch-naming',
          component: <BranchNamingRow />,
        },
        {
          id: 'auto-trust-worktrees',
          component: <AutoTrustWorktreesRow />,
        },
      ],
    },
    sessions: {
      title: t('settings.tabs.sessions'),
      description: t('settings.sessionsTab.description'),
      sections: [
        {
          id: 'session-create',
          title: t('settings.sessions.createTitle'),
          description: t('settings.sessions.createDescription'),
          component: <EnableTmuxRow />,
        },
        {
          id: 'session-assistance',
          title: t('settings.sessions.assistanceTitle'),
          description: t('settings.sessions.assistanceDescription'),
          component: <SessionAiSettingsCard />,
        },
        {
          id: 'session-events',
          title: t('settings.sessions.eventsTitle'),
          description: t('settings.sessions.eventsDescription'),
          surface: 'plain',
          component: <NotificationSettingsCard />,
        },
        {
          id: 'session-archive',
          title: t('settings.sessions.archiveTitle'),
          description: t('settings.sessions.archiveDescription'),
          component: <PreArchiveCommandRow />,
        },
      ],
    },
    account: {
      title: t('settings.tabs.account'),
      description: t('settings.account.description'),
      sections: [{ id: 'account', component: <AccountTab /> }],
    },
    'clis-models': {
      title: t('settings.tabs.agents'),
      description: t('settings.agentsTab.description'),
      sections: [
        { id: 'default-agent', component: <DefaultRuntimeSettingsCard /> },
        {
          id: 'cli-agents',
          title: t('settings.agentsTab.cliAgents'),
          action: <CliAgentsRescanButton />,
          surface: 'plain',
          component: <RuntimeAccordion focusRuntimeId={focusRuntimeId} />,
        },
      ],
    },
    models: {
      title: t('settings.models.title'),
      description: t('settings.models.description'),
      sections: [
        {
          id: 'models-catalog-auto-update',
          component: <ModelCatalogAutomaticUpdateSetting />,
        },
        {
          id: 'models-catalog',
          title: t('settings.models.catalogTitle'),
          description: t('settings.models.catalogDescription'),
          surface: 'panel',
          component: <ModelsSettingsCard />,
        },
      ],
    },
    llm: {
      title: t('settings.llm.title'),
      description: t('settings.llm.description'),
      sections: [
        {
          id: 'llm-profiles',
          title: t('settings.llm.profilesSectionTitle'),
          description: t('settings.llm.profilesSectionDescription'),
          surface: 'panel',
          component: <LlmProfilesCard />,
        },
        {
          id: 'llm-profile-assignments',
          title: t('settings.llm.profileAssignmentsSectionTitle'),
          description: t('settings.llm.profileAssignmentsSectionDescription'),
          surface: 'panel',
          component: <LlmProfileAssignmentsCard />,
        },
        {
          id: 'llm-profile-debug',
          title: t('settings.llm.profileDebugSectionTitle'),
          description: t('settings.llm.profileDebugSectionDescription'),
          surface: 'panel',
          component: <LlmProfileDebugCard />,
        },
      ],
    },
    prompts: {
      title: t('settings.tabs.prompts'),
      description: t('settings.promptsTab.description'),
      sections: [
        {
          id: 'prompts',
          surface: 'plain',
          component: <PromptLibraryPanel embedded />,
        },
      ],
    },
    skills: {
      title: t('skills.title'),
      titleHint: <SkillsCatalogHint />,
      description: t('skills.subtitle'),
      sections: [{ id: 'skills', surface: 'plain', component: <SkillsView embedded /> }],
    },
    'agent-manager': {
      title: t('agentManager.title'),
      description: t('agentManager.subtitle'),
      sections: [
        { id: 'agent-manager', surface: 'plain', component: <AgentManagerView embedded /> },
      ],
    },
    maas: {
      title: t('maas.title'),
      description: t('maas.subtitle'),
      component: (
        // Remount on a new deep-link so the requested Profile expands even when
        // the pane is already open.
        <MaasView
          key={focusMaasPlatformId ?? ''}
          embedded
          requestedPlatformId={focusMaasPlatformId}
          onOpenMarketplace={() => navigate('library', { section: 'extensions' })}
        />
      ),
    },
    usage: {
      title: t('usage.title'),
      description: t('usage.subtitle'),
      sections: [{ id: 'usage', surface: 'plain', component: <UsageView embedded /> }],
    },
    'ai-logs': {
      title: t('aiLogs.title'),
      description: t('aiLogs.subtitle'),
      sections: [{ id: 'ai-logs', surface: 'plain', component: <AiLogsPanel /> }],
    },
    automation: {
      title: t('automation.title'),
      description: t('automation.subtitle'),
      sections: [
        { id: 'automation', surface: 'plain', component: <AutomationMainPanel embedded /> },
      ],
    },
    mobile: {
      title: t('sidebar.mobileConnection.title'),
      description: t('sidebar.mobileConnection.description'),
      sections: [{ id: 'mobile', surface: 'plain', component: <MobileView embedded /> }],
    },
    integrations: {
      title: t('settings.tabs.integrations'),
      description: t('settings.integrationsTab.description'),
      sections: [
        {
          id: 'integrations',
          title: t('settings.integrationsTab.title'),
          component: <IntegrationsCard />,
        },
      ],
    },
    'open-in': {
      title: t('settings.tabs.openIn'),
      description: t('settings.openInTab.description'),
      sections: [
        {
          id: 'open-in-apps',
          component: <OpenInAppsSettingsCard />,
        },
      ],
    },
    mcp: {
      title: t('settings.tabs.mcp'),
      description: t('mcp.subtitle'),
      sections: [{ id: 'mcp', surface: 'plain', component: <McpView embedded /> }],
    },
    repository: {
      title: t('settings.tabs.repository'),
      description: t('settings.repositoryTab.description'),
      sections: [
        {
          id: 'github-settings',
          title: t('settings.tabs.github'),
          component: <GithubSettingsCard />,
        },
        {
          id: 'archived-projects',
          title: t('settings.archivedProjects.title'),
          component: <ArchivedProjectsCard />,
        },
      ],
    },
    interface: {
      title: t('settings.tabs.interface'),
      description: t('settings.interfaceTab.description'),
      sections: [
        { id: 'theme', component: <ThemeCard /> },
        { id: 'sidebar-status-bar', component: <SidebarStatusBarSettingsRow /> },
        { id: 'session-share-display-level', component: <SessionShareDisplayLevelSettingsRow /> },
        { id: 'task-appearance', component: <TaskAppearanceSettingsCard /> },
      ],
    },
    terminal: {
      title: t('settings.tabs.terminal'),
      description: t('settings.terminalTab.description'),
      sections: [
        { id: 'terminal', component: <TerminalSettingsCard /> },
        {
          id: 'tmux',
          title: t('settings.terminal.tmux'),
          description: t('settings.tasks.enableTmuxDescription'),
          component: <TmuxSettingsChapter />,
        },
      ],
    },
    'keyboard-shortcuts': {
      title: t('settings.tabs.keyboardShortcuts'),
      description: t('settings.keyboardShortcutsTab.description'),
      sections: [
        {
          id: 'keyboard-shortcuts',
          component: <KeyboardSettingsCard />,
        },
      ],
    },
    kanban: {
      title: t('kanban.title'),
      description: t('kanban.subtitle'),
      sections: [
        {
          id: 'kanban',
          surface: 'plain',
          // The board fills its container height; columns scroll internally.
          component: (
            <div className="h-[65vh] min-h-80 overflow-hidden rounded-xl border border-border/70">
              <KanbanBoard />
            </div>
          ),
        },
      ],
    },
    roadmap: {
      title: t('roadmap.title'),
      description: t('roadmap.subtitle'),
      sections: [{ id: 'roadmap', surface: 'plain', component: <RoadmapView embedded /> }],
    },
  };

  const currentContent = tabContent[activeTab as keyof typeof tabContent];
  if (!currentContent) return null;

  return (
    <SectionPage
      groups={tabGroups}
      activeId={activeTab}
      onSelect={onTabChange}
      navLabel={t('common.settings')}
      title={currentContent.title}
      titleHint={currentContent.titleHint}
      description={currentContent.description}
    >
      {currentContent.component}
      {currentContent.sections?.map((section) => {
        const hasChapterHeader = Boolean(section.title || section.description || section.action);
        const usePanelSurface = section.surface !== 'plain';
        return (
          <div key={section.id} className="flex flex-col gap-3">
            {hasChapterHeader && (
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  {section.title && (
                    <h3 className="text-base font-semibold text-foreground">{section.title}</h3>
                  )}
                  {section.description && (
                    <p className="mt-1 max-w-2xl text-sm leading-relaxed text-foreground-muted">
                      {section.description}
                    </p>
                  )}
                </div>
                {section.action && <div className="shrink-0">{section.action}</div>}
              </div>
            )}
            {usePanelSurface ? (
              <div className="rounded-xl border border-border/70 bg-background p-4 @max-md:p-3">
                {section.component}
              </div>
            ) : (
              section.component
            )}
          </div>
        );
      })}
    </SectionPage>
  );
}
