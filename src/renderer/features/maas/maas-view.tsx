import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { MaasView } from './components/MaasView';

export function MaasTitlebar() {
  return <Titlebar />;
}

export function MaasMainPanel() {
  return <MaasView />;
}

export const maasView = {
  TitlebarSlot: MaasTitlebar,
  MainPanel: MaasMainPanel,
};
