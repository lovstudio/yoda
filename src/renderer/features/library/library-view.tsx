import { Check, Menu } from 'lucide-react';
import { createContext, Fragment, useCallback, useContext, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_LIBRARY_SECTION } from '@renderer/app/route-identity';
import { GlobalHooksMainPanel } from '@renderer/features/agent-hooks/global-hooks-view';
import { AgentManagerMainPanel } from '@renderer/features/agents-config/agent-manager-view';
import { AiLabView } from '@renderer/features/ai-lab/components/AiLabView';
import { AutomationMainPanel } from '@renderer/features/automation/automation-view';
import { ExtensionMarketplaceView } from '@renderer/features/extensions/ExtensionMarketplaceView';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { SectionNav, type SectionNavGroup } from '@renderer/lib/ui/section-nav';
import { cn } from '@renderer/utils/utils';

/** The Library groups the user's reusable resources behind one nav entry. */
export type LibrarySection =
  | 'extensions'
  | 'apps'
  | 'prompts'
  | 'agents'
  | 'skills'
  | 'plugins'
  | 'hooks'
  | 'mcp'
  | 'automation';

type LibrarySectionEntry = {
  id: LibrarySection;
  labelKey: string;
};

/**
 * Basics are the building blocks a session consumes directly; advanced entries
 * orchestrate or extend Yoda itself. The nav and the compact dropdown render
 * the same two groups so the taxonomy reads identically at every width.
 */
const SECTION_GROUPS: {
  id: 'basic' | 'advanced';
  sections: LibrarySectionEntry[];
}[] = [
  {
    id: 'basic',
    sections: [
      { id: 'prompts', labelKey: 'library.sections.prompts' },
      { id: 'skills', labelKey: 'library.sections.skills' },
      { id: 'plugins', labelKey: 'library.sections.plugins' },
      { id: 'hooks', labelKey: 'library.sections.hooks' },
      { id: 'mcp', labelKey: 'library.sections.mcp' },
      { id: 'agents', labelKey: 'library.sections.agents' },
    ],
  },
  {
    id: 'advanced',
    sections: [
      { id: 'automation', labelKey: 'library.sections.automation' },
      { id: 'extensions', labelKey: 'library.sections.extensions' },
      { id: 'apps', labelKey: 'library.sections.apps' },
    ],
  },
];

const SECTIONS: LibrarySectionEntry[] = SECTION_GROUPS.flatMap((group) => group.sections);

/** SECTION_GROUPS with labels resolved, in the shape the shared nav rail takes. */
function useLibraryNavGroups(): SectionNavGroup<LibrarySection>[] {
  const { t } = useTranslation();
  return SECTION_GROUPS.map(({ id, sections }) => ({
    id,
    items: sections.map(({ id: sectionId, labelKey }) => ({
      id: sectionId,
      label: t(labelKey),
    })),
  }));
}

const LibrarySectionContext = createContext<{
  section: LibrarySection;
  onSectionChange: (section: LibrarySection) => void;
  appId: string | null;
  onAppChange: (appId: string | null) => void;
  createPrompt: boolean;
  onCreatePromptConsumed: () => void;
}>({
  section: 'prompts',
  onSectionChange: () => {},
  appId: null,
  onAppChange: () => {},
  createPrompt: false,
  onCreatePromptConsumed: () => {},
});

export function LibraryViewWrapper({
  children,
  section = DEFAULT_LIBRARY_SECTION,
  appId,
  createPrompt = false,
}: {
  children: ReactNode;
  section?: LibrarySection;
  appId?: string;
  createPrompt?: boolean;
}) {
  const { params, setParams } = useParams('library');
  const resolvedSection = isLibrarySection(section) ? section : DEFAULT_LIBRARY_SECTION;
  const shouldCreatePrompt = createPrompt || params.createPrompt === true;
  const onSectionChange = useCallback(
    (next: LibrarySection) => setParams({ section: next }),
    [setParams]
  );
  const onAppChange = useCallback(
    (next: string | null) => setParams({ appId: next ?? undefined }),
    [setParams]
  );
  const onCreatePromptConsumed = useCallback(
    () => setParams({ createPrompt: undefined }),
    [setParams]
  );
  return (
    <LibrarySectionContext.Provider
      value={{
        section: resolvedSection,
        onSectionChange,
        appId: appId ?? null,
        onAppChange,
        createPrompt: shouldCreatePrompt,
        onCreatePromptConsumed,
      }}
    >
      {children}
    </LibrarySectionContext.Provider>
  );
}

function isLibrarySection(section: unknown): section is LibrarySection {
  return SECTIONS.some(({ id }) => id === section);
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
  createPrompt,
  onCreatePromptConsumed,
}: {
  section: LibrarySection;
  appId: string | null;
  onAppChange: (appId: string | null) => void;
  createPrompt: boolean;
  onCreatePromptConsumed: () => void;
}) {
  switch (section) {
    case 'extensions':
      return <ExtensionMarketplaceView />;
    case 'apps':
      return <AiLabView embedded activeAppId={appId} onActiveAppChange={onAppChange} />;
    case 'prompts':
      return (
        <PromptLibraryPanel
          initialAction={createPrompt ? 'create' : undefined}
          onInitialActionConsumed={onCreatePromptConsumed}
        />
      );
    case 'agents':
      return <AgentManagerMainPanel />;
    case 'skills':
      return <SkillsMainPanel />;
    case 'plugins':
      return <PluginsView />;
    case 'hooks':
      return <GlobalHooksMainPanel />;
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
        {SECTION_GROUPS.map(({ id: groupId, sections }, groupIndex) => (
          <Fragment key={groupId}>
            {groupIndex > 0 && <DropdownMenuSeparator />}
            {sections.map(({ id, labelKey }) => (
              <DropdownMenuItem key={id} onClick={() => onSectionChange(id)}>
                <span className="truncate">{t(labelKey)}</span>
                {id === activeSection && <Check className="ml-auto size-3.5" />}
              </DropdownMenuItem>
            ))}
          </Fragment>
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
  const { section, onSectionChange, appId, onAppChange, createPrompt, onCreatePromptConsumed } =
    useLibrarySection();
  const navGroups = useLibraryNavGroups();
  // In the side pane the chip-strip row hosts the picker — don't double it.
  const isPinHosted = useIsPinHosted();
  return (
    // @container so the layout adapts to its host's width (full window, shell
    // side pane, …) instead of the viewport.
    <div className="@container flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background text-foreground">
      {/* The nav rail collapses below @lg, where it's too cramped to be usable;
          the picker moves into the content header (or the chip-strip when
          pin-hosted). */}
      <SectionNav
        groups={navGroups}
        activeId={section}
        onSelect={onSectionChange}
        className="w-max min-w-32 shrink-0 border-r border-border p-2 @max-lg:hidden"
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {!isPinHosted && (
          <div className="hidden shrink-0 items-center justify-end border-b border-border px-3 py-1.5 @max-lg:flex">
            <LibrarySectionDropdown section={section} onSectionChange={onSectionChange} />
          </div>
        )}
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <LibrarySectionContent
            section={section}
            appId={appId}
            onAppChange={onAppChange}
            createPrompt={createPrompt}
            onCreatePromptConsumed={onCreatePromptConsumed}
          />
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
