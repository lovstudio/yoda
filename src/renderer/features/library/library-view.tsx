import { createContext, useCallback, useContext, type ReactNode } from 'react';
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
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { SectionNavDropdown, type SectionNavGroup } from '@renderer/lib/ui/section-nav';
import { SectionPage } from '@renderer/lib/ui/section-page';

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
  descriptionKey: string;
  /** Sections that own their height and scrolling (a running app) fill instead. */
  fill?: boolean;
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
      {
        id: 'prompts',
        labelKey: 'library.sections.prompts',
        descriptionKey: 'promptLibrary.subtitle',
      },
      { id: 'skills', labelKey: 'library.sections.skills', descriptionKey: 'skills.subtitle' },
      { id: 'plugins', labelKey: 'library.sections.plugins', descriptionKey: 'plugins.subtitle' },
      { id: 'hooks', labelKey: 'library.sections.hooks', descriptionKey: 'hooksLibrary.subtitle' },
      { id: 'mcp', labelKey: 'library.sections.mcp', descriptionKey: 'mcp.subtitle' },
      {
        id: 'agents',
        labelKey: 'library.sections.agents',
        descriptionKey: 'agentManager.subtitle',
      },
    ],
  },
  {
    id: 'advanced',
    sections: [
      {
        id: 'automation',
        labelKey: 'library.sections.automation',
        descriptionKey: 'automation.subtitle',
      },
      {
        id: 'extensions',
        labelKey: 'library.sections.extensions',
        descriptionKey: 'extensions.subtitle',
      },
      {
        id: 'apps',
        labelKey: 'library.sections.apps',
        descriptionKey: 'aiLab.subtitle',
        fill: true,
      },
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
  // Every panel renders embedded: the shell already supplies the page frame,
  // the title and the description, so a panel only brings its own body.
  switch (section) {
    case 'extensions':
      return <ExtensionMarketplaceView embedded />;
    case 'apps':
      return <AiLabView embedded activeAppId={appId} onActiveAppChange={onAppChange} />;
    case 'prompts':
      return (
        <PromptLibraryPanel
          embedded
          initialAction={createPrompt ? 'create' : undefined}
          onInitialActionConsumed={onCreatePromptConsumed}
        />
      );
    case 'agents':
      return <AgentManagerMainPanel embedded />;
    case 'skills':
      return <SkillsMainPanel embedded />;
    case 'plugins':
      return <PluginsView embedded />;
    case 'hooks':
      return <GlobalHooksMainPanel embedded />;
    case 'mcp':
      return <McpMainPanel embedded />;
    case 'automation':
      return <AutomationMainPanel embedded />;
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
  const navGroups = useLibraryNavGroups();
  return (
    <SectionNavDropdown
      groups={navGroups}
      activeId={activeSection}
      onSelect={onSectionChange}
      label={t('sidebar.library')}
      className={className}
    />
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
  const { t } = useTranslation();
  const navGroups = useLibraryNavGroups();
  const entry = SECTIONS.find(({ id }) => id === section) ?? SECTIONS[0];
  return (
    // @container so the layout adapts to its host's width (full window, shell
    // side pane, …) instead of the viewport.
    <div className="@container flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background text-foreground">
      <SectionPage
        groups={navGroups}
        activeId={section}
        onSelect={onSectionChange}
        navLabel={t('sidebar.library')}
        title={t(entry.labelKey)}
        description={t(entry.descriptionKey)}
        fill={entry.fill}
      >
        <LibrarySectionContent
          section={section}
          appId={appId}
          onAppChange={onAppChange}
          createPrompt={createPrompt}
          onCreatePromptConsumed={onCreatePromptConsumed}
        />
      </SectionPage>
    </div>
  );
}

export const libraryView = {
  WrapView: LibraryViewWrapper,
  TitlebarSlot: LibraryTitlebar,
  MainPanel: LibraryMainPanel,
  PaneHeaderSlot: LibraryPaneHeaderSlot,
};
