import { Bot, FileText, Plug, Puzzle, Users, Workflow } from 'lucide-react';
import { createContext, useCallback, useContext, type ComponentType, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AgentTeamsMainPanel } from '@renderer/features/agent-teams/agent-teams-panel';
import { AgentManagerMainPanel } from '@renderer/features/agents-config/agent-manager-view';
import { AutomationMainPanel } from '@renderer/features/automation/automation-view';
import { McpMainPanel } from '@renderer/features/mcp/mcp-view';
import { PromptLibraryPanel } from '@renderer/features/prompt-library/prompt-library-panel';
import { SkillsMainPanel } from '@renderer/features/skills/skills-view';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { cn } from '@renderer/utils/utils';

/** The Library groups the user's reusable resources behind one nav entry. */
export type LibrarySection = 'prompts' | 'agents' | 'agentTeams' | 'skills' | 'mcp' | 'automation';

const SECTIONS: {
  id: LibrarySection;
  icon: ComponentType<{ className?: string }>;
  labelKey: string;
}[] = [
  { id: 'prompts', icon: FileText, labelKey: 'library.sections.prompts' },
  { id: 'agents', icon: Bot, labelKey: 'library.sections.agents' },
  { id: 'agentTeams', icon: Users, labelKey: 'library.sections.agentTeams' },
  { id: 'skills', icon: Puzzle, labelKey: 'library.sections.skills' },
  { id: 'mcp', icon: Plug, labelKey: 'library.sections.mcp' },
  { id: 'automation', icon: Workflow, labelKey: 'library.sections.automation' },
];

const LibrarySectionContext = createContext<{
  section: LibrarySection;
  onSectionChange: (section: LibrarySection) => void;
}>({ section: 'prompts', onSectionChange: () => {} });

export function LibraryViewWrapper({
  children,
  section = 'prompts',
}: {
  children: ReactNode;
  section?: LibrarySection;
}) {
  const { setParams } = useParams('library');
  const onSectionChange = useCallback(
    (next: LibrarySection) => setParams({ section: next }),
    [setParams]
  );
  return (
    <LibrarySectionContext.Provider value={{ section, onSectionChange }}>
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

function LibrarySectionContent({ section }: { section: LibrarySection }) {
  switch (section) {
    case 'prompts':
      return <PromptLibraryPanel />;
    case 'agents':
      return <AgentManagerMainPanel />;
    case 'agentTeams':
      return <AgentTeamsMainPanel />;
    case 'skills':
      return <SkillsMainPanel />;
    case 'mcp':
      return <McpMainPanel />;
    case 'automation':
      return <AutomationMainPanel />;
  }
}

export function LibraryMainPanel() {
  const { t } = useTranslation();
  const { section, onSectionChange } = useLibrarySection();
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-background text-foreground">
      <nav className="flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-background-secondary p-2">
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
      <div className="min-w-0 flex-1 overflow-hidden">
        <LibrarySectionContent section={section} />
      </div>
    </div>
  );
}

export const libraryView = {
  WrapView: LibraryViewWrapper,
  TitlebarSlot: LibraryTitlebar,
  MainPanel: LibraryMainPanel,
};
