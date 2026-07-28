import { AppWindow, Check, Menu, Store, type LucideIcon } from 'lucide-react';
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AiLabView } from '@renderer/features/ai-lab/components/AiLabView';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useIsPinHosted, useParams } from '@renderer/lib/layout/navigation-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';
import { ExtensionMarketplaceView } from './ExtensionMarketplaceView';

export type MarketplaceSection = 'extensions' | 'apps';

const SECTIONS: {
  id: MarketplaceSection;
  icon: LucideIcon;
  labelKey: string;
}[] = [
  { id: 'extensions', icon: Store, labelKey: 'marketplace.sections.extensions' },
  { id: 'apps', icon: AppWindow, labelKey: 'marketplace.sections.apps' },
];

const MarketplaceSectionContext = createContext<{
  section: MarketplaceSection;
  onSectionChange: (section: MarketplaceSection) => void;
  appId: string | null;
  onAppChange: (appId: string | null) => void;
}>({
  section: 'extensions',
  onSectionChange: () => {},
  appId: null,
  onAppChange: () => {},
});

export function MarketplaceViewWrapper({
  children,
  section = 'extensions',
  appId,
}: {
  children: ReactNode;
  section?: MarketplaceSection;
  appId?: string;
}) {
  const { setParams } = useParams('marketplace');
  const resolvedSection = isMarketplaceSection(section) ? section : 'extensions';
  const onSectionChange = useCallback(
    (next: MarketplaceSection) => setParams({ section: next }),
    [setParams]
  );
  const onAppChange = useCallback(
    (next: string | null) => setParams({ appId: next ?? undefined }),
    [setParams]
  );
  return (
    <MarketplaceSectionContext.Provider
      value={{ section: resolvedSection, onSectionChange, appId: appId ?? null, onAppChange }}
    >
      {children}
    </MarketplaceSectionContext.Provider>
  );
}

function isMarketplaceSection(section: unknown): section is MarketplaceSection {
  return SECTIONS.some(({ id }) => id === section);
}

function useMarketplaceSection() {
  return useContext(MarketplaceSectionContext);
}

export function MarketplaceTitlebar() {
  return <Titlebar />;
}

function MarketplaceSectionContent({
  section,
  appId,
  onAppChange,
}: {
  section: MarketplaceSection;
  appId: string | null;
  onAppChange: (appId: string | null) => void;
}) {
  switch (section) {
    case 'extensions':
      return <ExtensionMarketplaceView />;
    case 'apps':
      return <AiLabView embedded activeAppId={appId} onActiveAppChange={onAppChange} />;
  }
}

export function MarketplaceSectionDropdown({
  section: activeSection,
  onSectionChange,
  className,
}: {
  section: MarketplaceSection;
  onSectionChange: (section: MarketplaceSection) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('sidebar.marketplace')}
        title={t('sidebar.marketplace')}
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

export function MarketplacePaneHeaderSlot() {
  const { section, onSectionChange } = useMarketplaceSection();
  return <MarketplaceSectionDropdown section={section} onSectionChange={onSectionChange} />;
}

export function MarketplaceMainPanel() {
  const { t } = useTranslation();
  const { section, onSectionChange, appId, onAppChange } = useMarketplaceSection();
  const isPinHosted = useIsPinHosted();
  return (
    <div className="@container flex min-h-0 flex-1 overflow-hidden bg-background text-foreground">
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
            <MarketplaceSectionDropdown section={section} onSectionChange={onSectionChange} />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-hidden">
          <MarketplaceSectionContent section={section} appId={appId} onAppChange={onAppChange} />
        </div>
      </div>
    </div>
  );
}
