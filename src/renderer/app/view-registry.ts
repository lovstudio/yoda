import type { ComponentType, ReactNode } from 'react';
import { homeView } from '@renderer/app/home-view';
import { agentManagerView } from '@renderer/features/agents-config/agent-manager-view';
import { agentsView } from '@renderer/features/agents/agents-view';
import { automationView } from '@renderer/features/automation/automation-view';
import { maasView } from '@renderer/features/maas/maas-view';
import { mcpView } from '@renderer/features/mcp/mcp-view';
import { mobileView } from '@renderer/features/mobile/mobile-view';
import { projectFileView } from '@renderer/features/project-file/view';
import { projectView } from '@renderer/features/projects/view';
import { roadmapView } from '@renderer/features/roadmap/roadmap-view';
import { settingsView } from '@renderer/features/settings/settings-view';
import { skillsView } from '@renderer/features/skills/skills-view';
import { taskView } from '@renderer/features/tasks/view';
import { usageView } from '@renderer/features/usage/usage-view';
import type { CommandProvider } from '@renderer/lib/commands/types';

// Define views here so we can use them in the navigate function
export const views = {
  home: homeView,
  agentManager: agentManagerView,
  agents: agentsView,
  automation: automationView,
  maas: maasView,
  usage: usageView,
  skills: skillsView,
  mcp: mcpView,
  mobile: mobileView,
  roadmap: roadmapView,
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
