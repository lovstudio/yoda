import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { MaasView } from './components/MaasView';

export function MaasTitlebar() {
  return <Titlebar />;
}

export function MaasMainPanel() {
  const { navigate } = useNavigate();
  return <MaasView onOpenMarketplace={() => navigate('library', { section: 'extensions' })} />;
}

export const maasView = {
  TitlebarSlot: MaasTitlebar,
  MainPanel: MaasMainPanel,
};
