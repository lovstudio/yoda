import { createElement, lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import type { RuntimeId } from '@shared/runtime-registry';
import { homeView } from '@renderer/app/home-view';
import type { LibrarySection } from '@renderer/features/library/library-view';
import { projectFileView } from '@renderer/features/project-file/view';
import { projectView } from '@renderer/features/projects/view';
import type { SettingsPageTab } from '@renderer/features/settings/components/SettingsPage';
import { taskView } from '@renderer/features/tasks/view';
import type { CommandProvider } from '@renderer/lib/commands/types';

type EmptyProps = Record<never, never>;

function deferredExport<Props extends object = EmptyProps>(
  loader: () => Promise<object>,
  exportName: string
): ComponentType<Props> {
  const Component = lazy(async () => {
    const module = (await loader()) as Record<string, unknown>;
    const selected = module[exportName];
    if (typeof selected !== 'function' && typeof selected !== 'object') {
      throw new Error(`Deferred view export not found: ${exportName}`);
    }
    return { default: selected as ComponentType<Props> };
  });
  return function DeferredComponent(props: Props) {
    return createElement(Suspense, { fallback: null }, createElement(Component, props));
  };
}

const agentManagerModule = () => import('@renderer/features/agents-config/agent-manager-view');
const agentManagerView = {
  WrapView: deferredExport<{ children?: ReactNode }>(agentManagerModule, 'AgentManagerWrapView'),
  TitlebarSlot: deferredExport(agentManagerModule, 'AgentManagerTitlebar'),
  MainPanel: deferredExport(agentManagerModule, 'AgentManagerMainPanel'),
};

const agentsModule = () => import('@renderer/features/agents/agents-view');
const agentsView = {
  TitlebarSlot: deferredExport(agentsModule, 'AgentsTitlebar'),
  MainPanel: deferredExport(agentsModule, 'AgentsMainPanel'),
};

const aiLabModule = () => import('@renderer/features/ai-lab/ai-lab-view');
const aiLabView = {
  TitlebarSlot: deferredExport(aiLabModule, 'AiLabTitlebar'),
  MainPanel: deferredExport(aiLabModule, 'AiLabMainPanel'),
};

const automationModule = () => import('@renderer/features/automation/automation-view');
const automationView = {
  TitlebarSlot: deferredExport(automationModule, 'AutomationTitlebar'),
  MainPanel: deferredExport(automationModule, 'AutomationMainPanel'),
};

const kanbanModule = () => import('@renderer/features/kanban/kanban-view');
const kanbanView = {
  TitlebarSlot: deferredExport(kanbanModule, 'KanbanTitlebar'),
  MainPanel: deferredExport(kanbanModule, 'KanbanMainPanel'),
};

type LibraryViewParams = { children: ReactNode; section?: LibrarySection; appId?: string };
const libraryModule = () => import('@renderer/features/library/library-view');
const libraryView = {
  WrapView: deferredExport<LibraryViewParams>(libraryModule, 'LibraryViewWrapper'),
  TitlebarSlot: deferredExport(libraryModule, 'LibraryTitlebar'),
  MainPanel: deferredExport(libraryModule, 'LibraryMainPanel'),
  PaneHeaderSlot: deferredExport(libraryModule, 'LibraryPaneHeaderSlot'),
};

const maasModule = () => import('@renderer/features/maas/maas-view');
const maasView = {
  TitlebarSlot: deferredExport(maasModule, 'MaasTitlebar'),
  MainPanel: deferredExport(maasModule, 'MaasMainPanel'),
};

const mcpModule = () => import('@renderer/features/mcp/mcp-view');
const mcpView = {
  TitlebarSlot: deferredExport(mcpModule, 'McpTitlebar'),
  MainPanel: deferredExport(mcpModule, 'McpMainPanel'),
};

const mobileModule = () => import('@renderer/features/mobile/mobile-view');
const mobileView = {
  TitlebarSlot: deferredExport(mobileModule, 'MobileTitlebar'),
  MainPanel: deferredExport(mobileModule, 'MobileMainPanel'),
};

const projectsOverviewModule = () => import('@renderer/features/projects/projects-overview-view');
const projectsOverviewView = {
  TitlebarSlot: deferredExport(projectsOverviewModule, 'ProjectsOverviewTitlebar'),
  MainPanel: deferredExport(projectsOverviewModule, 'ProjectsOverviewMainPanel'),
};

const roadmapModule = () => import('@renderer/features/roadmap/roadmap-view');
const roadmapView = {
  TitlebarSlot: deferredExport(roadmapModule, 'RoadmapTitlebar'),
  MainPanel: deferredExport(roadmapModule, 'RoadmapMainPanel'),
};

type SettingsViewParams = {
  children: ReactNode;
  tab?: SettingsPageTab;
  runtimeId?: RuntimeId;
};
const settingsModule = () => import('@renderer/features/settings/settings-view');
const settingsView = {
  WrapView: deferredExport<SettingsViewParams>(settingsModule, 'SettingsViewWrapper'),
  TitlebarSlot: deferredExport(settingsModule, 'SettingsTitlebar'),
  MainPanel: deferredExport(settingsModule, 'SettingsMainPanel'),
  PaneHeaderSlot: deferredExport(settingsModule, 'SettingsPaneHeaderSlot'),
};

type SkillCompareViewParams = {
  children?: ReactNode;
  baseSkillId: string;
  targetSkillId: string;
  baseDisplayName?: string;
  targetDisplayName?: string;
};
const skillCompareModule = () => import('@renderer/features/skills/skill-compare-view');
const skillCompareView = {
  WrapView: deferredExport<SkillCompareViewParams>(skillCompareModule, 'SkillCompareWrapView'),
  TitlebarSlot: deferredExport(skillCompareModule, 'SkillCompareTitlebar'),
  MainPanel: deferredExport(skillCompareModule, 'SkillCompareMainPanel'),
};

type SkillDetailViewParams = {
  children?: ReactNode;
  skillId: string;
  displayName?: string;
  catalogSection?: 'installed' | 'recommended' | 'attention';
};
const skillDetailModule = () => import('@renderer/features/skills/skill-detail-view');
const skillDetailView = {
  WrapView: deferredExport<SkillDetailViewParams>(skillDetailModule, 'SkillDetailWrapView'),
  TitlebarSlot: deferredExport(skillDetailModule, 'SkillDetailTitlebar'),
  MainPanel: deferredExport(skillDetailModule, 'SkillDetailMainPanel'),
};

type SkillsViewParams = { children?: ReactNode; focusSkillId?: string };
const skillsModule = () => import('@renderer/features/skills/skills-view');
const skillsView = {
  WrapView: deferredExport<SkillsViewParams>(skillsModule, 'SkillsWrapView'),
  TitlebarSlot: deferredExport(skillsModule, 'SkillsTitlebar'),
  MainPanel: deferredExport(skillsModule, 'SkillsMainPanel'),
};

const usageModule = () => import('@renderer/features/usage/usage-view');
const usageView = {
  TitlebarSlot: deferredExport(usageModule, 'UsageTitlebar'),
  MainPanel: deferredExport(usageModule, 'UsageMainPanel'),
};

// Define views here so we can use them in the navigate function
export const views = {
  home: homeView,
  agentManager: agentManagerView,
  agents: agentsView,
  aiLab: aiLabView,
  automation: automationView,
  maas: maasView,
  usage: usageView,
  library: libraryView,
  skills: skillsView,
  skill: skillDetailView,
  skillCompare: skillCompareView,
  mcp: mcpView,
  mobile: mobileView,
  roadmap: roadmapView,
  kanban: kanbanView,
  projectsOverview: projectsOverviewView,
  project: projectView,
  task: taskView,
  file: projectFileView,
  settings: settingsView,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<string, ViewDefinition<any>>;

export type ViewDefinition<TParams extends object = Record<never, never>> = {
  WrapView?: ComponentType<{ children: ReactNode } & TParams>;
  TitlebarSlot?: ComponentType;
  MainPanel: ComponentType;
  /**
   * Optional accessory rendered at the right end of the shell side pane's
   * chip-strip row while this view is the active pin (e.g. the settings
   * view's tab picker). Rendered inside the pin's WrapView + params override.
   */
  PaneHeaderSlot?: ComponentType;
  /**
   * Factory called by Workspace whenever this view becomes active.
   * The returned CommandProvider is registered in commandRegistry and
   * unregistered when the view changes or the params change.
   */
  commandProvider?: (params: TParams) => CommandProvider;
};

type Views = typeof views;

export type ViewId = keyof Views;

export type WrapParams<TId extends ViewId> = Views[TId] extends {
  WrapView: ComponentType<infer P>;
}
  ? Omit<P, 'children'>
  : Record<never, never>;
