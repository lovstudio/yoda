import { createContext, useCallback, useContext, type ReactNode } from 'react';
import {
  SettingsPage,
  SettingsTabsDropdown,
  type SettingsPageTab,
} from '@renderer/features/settings/components/SettingsPage';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useParams } from '@renderer/lib/layout/navigation-provider';

const SettingsTabContext = createContext<{
  tab: SettingsPageTab;
  onTabChange: (tab: SettingsPageTab) => void;
}>({ tab: 'general', onTabChange: () => {} });

/** Minimal passthrough — exists so the registry can infer WrapParams<'settings'>. */
export function SettingsViewWrapper({
  children,
  tab = 'general',
}: {
  children: ReactNode;
  tab?: SettingsPageTab;
}) {
  const { setParams } = useParams('settings');
  const handleTabChange = useCallback(
    (tab: SettingsPageTab) => {
      setParams({ tab });
    },
    [setParams]
  );
  return (
    <SettingsTabContext.Provider value={{ tab, onTabChange: handleTabChange }}>
      {children}
    </SettingsTabContext.Provider>
  );
}

export function useSettingsTab() {
  if (!useContext(SettingsTabContext)) {
    throw new Error('useSettingsTab must be used within a SettingsViewWrapper');
  }
  return useContext(SettingsTabContext);
}

export function SettingsTitlebar() {
  return <Titlebar />;
}

/** Tab picker hung at the right end of the side pane's chip-strip row. */
export function SettingsPaneHeaderSlot() {
  const { tab, onTabChange } = useSettingsTab();
  return <SettingsTabsDropdown tab={tab} onTabChange={onTabChange} />;
}

export function SettingsMainPanel() {
  const { tab, onTabChange } = useSettingsTab();
  return (
    // @container so SettingsPage adapts to its host's width (full window,
    // shell side pane, …) instead of the viewport.
    <div className="@container relative z-10 flex min-h-0 flex-1 overflow-hidden bg-background">
      <SettingsPage tab={tab} onTabChange={onTabChange} />
    </div>
  );
}

export const settingsView = {
  WrapView: SettingsViewWrapper,
  TitlebarSlot: SettingsTitlebar,
  MainPanel: SettingsMainPanel,
  PaneHeaderSlot: SettingsPaneHeaderSlot,
};
