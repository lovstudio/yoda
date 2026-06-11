import { Check, Menu } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { AgentManagerView } from '@renderer/features/agents-config/agent-manager-view';
import { AgentsView } from '@renderer/features/agents/components/AgentsView';
import { AutomationMainPanel } from '@renderer/features/automation/automation-view';
import { MaasView } from '@renderer/features/maas/components/MaasView';
import { McpView } from '@renderer/features/mcp/components/McpView';
import { MobileView } from '@renderer/features/mobile/mobile-view';
import SkillsView from '@renderer/features/skills/components/SkillsView';
import { NamingConfigFields } from '@renderer/features/tasks/components/naming-config-fields';
import { SummaryConfigFields } from '@renderer/features/tasks/components/summary-config-fields';
import { UsageView } from '@renderer/features/usage/components/UsageView';
import { useIsPinHosted } from '@renderer/lib/layout/navigation-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Separator } from '@renderer/lib/ui/separator';
import { cn } from '@renderer/utils/utils';
import { AccountTab } from './AccountTab';
import ArchivedProjectsCard from './ArchivedProjectsCard';
import { CliAgentsList } from './CliAgentsList';
import DefaultRuntimeSettingsCard from './DefaultRuntimeSettingsCard';
import GithubSettingsCard from './GithubSettingsCard';
import IntegrationsCard from './IntegrationsCard';
import KeyboardSettingsCard from './KeyboardSettingsCard';
import LanguageCard from './LanguageCard';
import NotificationSettingsCard from './NotificationSettingsCard';
import OpenInAppsSettingsCard from './OpenInAppsSettingsCard';
import { ReviewPromptResetButton, ReviewPromptSettingsCard } from './ReviewPromptSettingsCard';
import StatuslineSettingsCard from './StatuslineSettingsCard';
import {
  AutoGenerateTaskNamesRow,
  AutoTrustWorktreesRow,
  EnableTmuxRow,
  PreArchiveCommandRow,
} from './TaskSettingsRows';
import TelemetryCard from './TelemetryCard';
import TerminalSettingsCard from './TerminalSettingsCard';
import ThemeCard from './ThemeCard';
import { UpdateCard } from './UpdateCard';

export type SettingsPageTab =
  | 'general'
  | 'account'
  | 'clis-models'
  | 'tasks'
  | 'integrations'
  | 'open-in'
  | 'mcp'
  | 'skills'
  | 'agent-manager'
  | 'maas'
  | 'usage'
  | 'automation'
  | 'mobile'
  | 'repository'
  | 'interface'
  | 'terminal'
  | 'keyboard-shortcuts';

interface SectionConfig {
  id: string;
  title?: string;
  action?: React.ReactNode;
  component: React.ReactNode;
}

type SettingsTabEntry = { id: SettingsPageTab; label: string };

/** Grouped tabs; groups are visually separated. Account leads the first group. */
function useSettingsTabGroups(): SettingsTabEntry[][] {
  const { t } = useTranslation();
  return [
    // Identity: account + its usage.
    [
      { id: 'account', label: t('settings.tabs.account') },
      { id: 'usage', label: t('settings.tabs.usage') },
    ],
    // App-wide preferences.
    [
      { id: 'general', label: t('settings.tabs.general') },
      { id: 'interface', label: t('settings.tabs.interface') },
      { id: 'terminal', label: t('settings.tabs.terminal') },
      { id: 'keyboard-shortcuts', label: t('settings.tabs.keyboardShortcuts') },
    ],
    // Projects and the tasks that run inside them.
    [
      { id: 'repository', label: t('settings.tabs.repository') },
      { id: 'tasks', label: t('settings.tabs.tasks') },
    ],
    // Agent execution: runtimes and their capabilities.
    [
      { id: 'maas', label: t('settings.tabs.maas') },
      { id: 'clis-models', label: t('settings.tabs.agents') },
      { id: 'skills', label: t('settings.tabs.skills') },
      { id: 'mcp', label: t('settings.tabs.mcp') },
      { id: 'agent-manager', label: t('settings.tabs.agentManager') },
    ],
    // Product integrations and companion surfaces.
    [
      { id: 'integrations', label: t('settings.tabs.integrations') },
      { id: 'open-in', label: t('settings.tabs.openIn') },
      { id: 'automation', label: t('settings.tabs.automation') },
      { id: 'mobile', label: t('settings.tabs.mobile') },
    ],
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
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('common.settings')}
        title={t('common.settings')}
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-muted hover:bg-background-2 hover:text-foreground',
          className
        )}
      >
        <Menu className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {tabGroups.map((group, groupIndex) => (
          <React.Fragment key={group[0]?.id ?? groupIndex}>
            {groupIndex > 0 && <DropdownMenuSeparator />}
            {group.map((tab) => (
              <DropdownMenuItem key={tab.id} onClick={() => onTabChange(tab.id)}>
                {tab.label}
                {tab.id === activeTab && <Check className="ml-auto size-3.5" />}
              </DropdownMenuItem>
            ))}
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SettingsPage({
  tab: activeTab,
  onTabChange,
}: {
  tab: SettingsPageTab;
  onTabChange: (tab: SettingsPageTab) => void;
}) {
  const { t } = useTranslation();
  const tabGroups = useSettingsTabGroups();
  // In the side pane the chip-strip row hosts the tab picker — don't double it.
  const isPinHosted = useIsPinHosted();

  const tabContent: Record<
    string,
    { title: string; description: string; sections: SectionConfig[] }
  > = {
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
          id: 'notifications',
          component: <NotificationSettingsCard />,
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
          id: 'auto-generate-task-names',
          component: <AutoGenerateTaskNamesRow />,
        },
        {
          id: 'task-naming-config',
          title: t('settings.tasks.namingConfigTitle'),
          component: (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-foreground-passive">
                {t('settings.tasks.namingConfigDescription')}
              </p>
              <NamingConfigFields />
            </div>
          ),
        },
        {
          id: 'session-summary-config',
          title: t('settings.tasks.summaryConfigTitle'),
          component: (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-foreground-passive">
                {t('settings.tasks.summaryConfigDescription')}
              </p>
              <SummaryConfigFields />
            </div>
          ),
        },
        {
          id: 'auto-trust-worktrees',
          component: <AutoTrustWorktreesRow />,
        },
        {
          id: 'enable-tmux',
          component: <EnableTmuxRow />,
        },
        {
          id: 'pre-archive-command',
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
          id: 'review-prompt',
          title: t('settings.agentsTab.reviewPrompt'),
          action: <ReviewPromptResetButton />,
          component: <ReviewPromptSettingsCard />,
        },
        {
          id: 'statusline-templates',
          title: t('settings.statusline.title'),
          component: <StatuslineSettingsCard />,
        },
        {
          id: 'cli-agents',
          title: t('settings.agentsTab.cliAgents'),
          component: (
            <div className="rounded-xl border border-border/60 bg-muted/10 p-2">
              <CliAgentsList />
            </div>
          ),
        },
        {
          id: 'runtime-detail',
          title: t('settings.agentsTab.runtimeDetail'),
          component: <AgentsView embedded />,
        },
      ],
    },
    skills: {
      title: t('skills.title'),
      description: t('skills.subtitle'),
      sections: [{ id: 'skills', component: <SkillsView embedded /> }],
    },
    'agent-manager': {
      title: t('agentManager.title'),
      description: t('agentManager.subtitle'),
      sections: [{ id: 'agent-manager', component: <AgentManagerView embedded /> }],
    },
    maas: {
      title: t('maas.title'),
      description: t('maas.subtitle'),
      sections: [{ id: 'maas', component: <MaasView embedded /> }],
    },
    usage: {
      title: t('usage.title'),
      description: t('usage.subtitle'),
      sections: [{ id: 'usage', component: <UsageView embedded /> }],
    },
    automation: {
      title: t('automation.title'),
      description: t('automation.subtitle'),
      sections: [{ id: 'automation', component: <AutomationMainPanel embedded /> }],
    },
    mobile: {
      title: t('sidebar.mobileConnection.title'),
      description: t('sidebar.mobileConnection.description'),
      sections: [{ id: 'mobile', component: <MobileView embedded /> }],
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
      sections: [{ id: 'mcp', component: <McpView embedded /> }],
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
      sections: [{ id: 'theme', component: <ThemeCard /> }],
    },
    terminal: {
      title: t('settings.tabs.terminal'),
      description: t('settings.terminalTab.description'),
      sections: [{ id: 'terminal', component: <TerminalSettingsCard /> }],
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
  };

  const currentContent = tabContent[activeTab as keyof typeof tabContent];

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1060px] flex-col gap-6 px-8 @max-2xl:px-4">
        {/* Narrow containers (shell side pane, slim windows) hide the nav
            column; tab switching moves into the content header's dropdown. */}
        <div className="grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)] gap-8 overflow-hidden @max-2xl:grid-cols-1 @max-2xl:grid-rows-[minmax(0,1fr)]">
          <div className="py-10 @max-2xl:hidden">
            <nav className="flex min-h-0 w-52 flex-col gap-0.5 overflow-y-auto">
              {tabGroups.map((group, groupIndex) => (
                <React.Fragment key={group[0]?.id ?? groupIndex}>
                  {groupIndex > 0 && <Separator className="my-2" />}
                  {group.map((tab) => {
                    const isActive = tab.id === activeTab;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => onTabChange(tab.id)}
                        className={cn(
                          'flex w-full items-center gap-2 hover:bg-background-1 text-foreground-muted hover:text-foreground rounded-md px-3 py-2 text-sm font-normal transition-colors',
                          isActive &&
                            'bg-background-2 text-foreground hover:bg-background-2 hover:text-foreground'
                        )}
                      >
                        <span className="text-left">{tab.label}</span>
                      </button>
                    );
                  })}
                </React.Fragment>
              ))}
            </nav>
          </div>
          {/* Content container */}
          {currentContent && (
            <div className="min-h-0 min-w-0 flex-1 justify-center overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]">
              <div className="mx-auto w-full max-w-4xl space-y-8 py-10 pr-4 pl-1 @max-2xl:py-4 @max-2xl:pr-0 @max-2xl:pl-0">
                <div className="flex flex-col gap-6">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-col gap-1">
                      <h2 className="text-xl">{currentContent.title}</h2>
                      <p className="text-sm text-foreground-muted">{currentContent.description}</p>
                    </div>
                    {/* Narrow main-area fallback — in the side pane the
                        chip-strip row hosts the picker instead. */}
                    {!isPinHosted && (
                      <SettingsTabsDropdown
                        tab={activeTab}
                        onTabChange={onTabChange}
                        className="hidden @max-2xl:flex"
                      />
                    )}
                  </div>
                  <Separator />
                </div>
                {currentContent.sections.map((section) => (
                  <div key={section.id} className="flex flex-col gap-3">
                    {section.title && (
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-normal text-foreground">{section.title}</h3>
                        {section.action && <div>{section.action}</div>}
                      </div>
                    )}
                    {section.component}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
