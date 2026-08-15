import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { MaasPlatformId } from '@shared/maas';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { MaasView } from './components/MaasView';

const MaasFocusContext = createContext<{ platformId?: MaasPlatformId }>({});

/** Carries the route's focused Profile so entry points can deep-link into it. */
export function MaasViewWrapper({
  children,
  platformId,
}: {
  children: ReactNode;
  platformId?: MaasPlatformId;
}) {
  const value = useMemo(() => ({ platformId }), [platformId]);
  return <MaasFocusContext.Provider value={value}>{children}</MaasFocusContext.Provider>;
}

export function MaasTitlebar() {
  return <Titlebar />;
}

export function MaasMainPanel() {
  const { navigate } = useNavigate();
  const { platformId } = useContext(MaasFocusContext);
  return (
    // Remount on a new deep-link so the requested Profile expands even when the
    // view is already open.
    <MaasView
      key={platformId ?? ''}
      requestedPlatformId={platformId}
      onOpenMarketplace={() => navigate('library', { section: 'extensions' })}
    />
  );
}

export const maasView = {
  WrapView: MaasViewWrapper,
  TitlebarSlot: MaasTitlebar,
  MainPanel: MaasMainPanel,
};
