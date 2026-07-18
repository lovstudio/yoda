import {
  AppWindow,
  Bot,
  Boxes,
  Check,
  FileText,
  Menu,
  Plug,
  Puzzle,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AgentTeamsMainPanel } from '@renderer/features/agent-teams/agent-teams-panel';
import { AgentManagerMainPanel } from '@renderer/features/agents-config/agent-manager-view';
import { AiLabView } from '@renderer/features/ai-lab/components/AiLabView';
import { AutomationMainPanel } from '@renderer/features/automation/automation-view';
import { McpMainPanel } from '@renderer/features/mcp/mcp-view';
import PluginsView from '@renderer/features/plugins/PluginsView';
import { PromptLibraryPanel } from '@renderer/features/prompt-library/prompt-library-panel';
import { SkillsMainPanel } from '@renderer/features/skills/skills-view';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useIsPinHosted, useParams } from '@renderer/lib/layout/navigation-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';

/** The Library groups the user's reusable resources behind one nav entry. */
export type LibrarySection =
  | 'apps'
  | 'prompts'
  | 'agents'
  | 'agentTeams'
  | 'skills'
  | 'plugins'
  | 'mcp'
  | 'automation';

const SECTIONS: {
  id: LibrarySection;
  icon: LucideIcon;
  labelKey: string;
}[] = [
  { id: 'apps', icon: AppWindow, labelKey: 'library.sections.apps' },
  { id: 'prompts', icon: FileText, labelKey: 'library.sections.prompts' },
  { id: 'agents', icon: Bot, labelKey: 'library.sections.agents' },
  { id: 'agentTeams', icon: Users, labelKey: 'library.sections.agentTeams' },
  { id: 'skills', icon: Boxes, labelKey: 'library.sections.skills' },
  { id: 'plugins', icon: Puzzle, labelKey: 'library.sections.plugins' },
  { id: 'mcp', icon: Plug, labelKey: 'library.sections.mcp' },
  { id: 'automation', icon: Workflow, labelKey: 'library.sections.automation' },
];

const LibrarySectionContext = createContext<{
  section: LibrarySection;
  onSectionChange: (section: LibrarySection) => void;
  appId: string | null;
  onAppChange: (appId: string | null) => void;
}>({ section: 'apps', onSectionChange: () => {}, appId: null, onAppChange: () => {} });

export function LibraryViewWrapper({
  children,
  section = 'apps',
  appId,
}: {
  children: ReactNode;
  section?: LibrarySection;
  appId?: string;
}) {
  const { setParams } = useParams('library');
  // Navigation snapshots from the earlier AI Lab placement may still carry
  // `aiLab`; migrate that hidden legacy value into the user-facing Apps shelf.
  const resolvedSection = (section as string) === 'aiLab' ? 'apps' : section;
  const onSectionChange = useCallback(
    (next: LibrarySection) => setParams({ section: next }),
    [setParams]
  );
  const onAppChange = useCallback(
    (next: string | null) => setParams({ appId: next ?? undefined }),
    [setParams]
  );
  return (
    <LibrarySectionContext.Provider
      value={{ section: resolvedSection, onSectionChange, appId: appId ?? null, onAppChange }}
    >
      {children}
    </LibrarySectionContext.Provider>
  );
}

function useLibrarySection() {
  return useContext(LibrarySectionContext);
}

export function LibraryTitlebar() {
  return <Titlebar />;
}

function LibrarySectionContent({
  section,
  appId,
  onAppChange,
}: {
  section: LibrarySection;
  appId: string | null;
  onAppChange: (appId: string | null) => void;
}) {
  switch (section) {
    case 'apps':
      return <AiLabView embedded activeAppId={appId} onActiveAppChange={onAppChange} />;
    case 'prompts':
      return <PromptLibraryPanel />;
    case 'agents':
      return <AgentManagerMainPanel />;
    case 'agentTeams':
      return <AgentTeamsMainPanel />;
    case 'skills':
      return <SkillsMainPanel />;
    case 'plugins':
      return <PluginsView />;
    case 'mcp':
      return <McpMainPanel />;
    case 'automation':
      return <AutomationMainPanel />;
  }
}

/** Section picker that replaces the nav rail when the host is too narrow for it
    (slim windows, the shell side pane). Mirrors the settings tab dropdown. */
export function LibrarySectionDropdown({
  section: activeSection,
  onSectionChange,
  className,
}: {
  section: LibrarySection;
  onSectionChange: (section: LibrarySection) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('sidebar.library')}
        title={t('sidebar.library')}
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-muted hover:bg-background-2 hover:text-foreground',
          className
        )}
      >
        <Menu className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {SECTIONS.map(({ id, icon: Icon, labelKey }) => (
          <DropdownMenuItem key={id} onClick={() => onSectionChange(id)}>
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{t(labelKey)}</span>
            {id === activeSection && <Check className="ml-auto size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Section picker hung at the right end of the side pane's chip-strip row. */
export function LibraryPaneHeaderSlot() {
  const { section, onSectionChange } = useLibrarySection();
  return <LibrarySectionDropdown section={section} onSectionChange={onSectionChange} />;
}

export function LibraryMainPanel() {
  const { t } = useTranslation();
  const { section, onSectionChange, appId, onAppChange } = useLibrarySection();
  // In the side pane the chip-strip row hosts the picker — don't double it.
  const isPinHosted = useIsPinHosted();
  return (
    // @container so the layout adapts to its host's width (full window, shell
    // side pane, …) instead of the viewport.
    <div className="@container flex min-h-0 flex-1 overflow-hidden bg-background text-foreground">
      {/* The nav rail collapses below @lg, where it's too cramped to be usable;
          the picker moves into the content header (or the chip-strip when
          pin-hosted). */}
      <nav className="flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-background-secondary p-2 @max-lg:hidden">
        {SECTIONS.map(({ id, icon: Icon, labelKey }) => {
          const active = id === section;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSectionChange(id)}
              aria-current={active}
              className={cn(
                'flex h-8 items-center gap-2 rounded-md px-2.5 text-sm transition-colors',
                active
                  ? 'bg-background-1 text-foreground'
                  : 'text-foreground-muted hover:bg-background-2 hover:text-foreground'
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="truncate">{t(labelKey)}</span>
            </button>
          );
        })}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {!isPinHosted && (
          <div className="hidden shrink-0 items-center justify-end border-b border-border px-3 py-1.5 @max-lg:flex">
            <LibrarySectionDropdown section={section} onSectionChange={onSectionChange} />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-hidden">
          <LibrarySectionContent section={section} appId={appId} onAppChange={onAppChange} />
        </div>
      </div>
    </div>
  );
}

export const libraryView = {
  WrapView: LibraryViewWrapper,
  TitlebarSlot: LibraryTitlebar,
  MainPanel: LibraryMainPanel,
  PaneHeaderSlot: LibraryPaneHeaderSlot,
};
