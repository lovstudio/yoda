import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { AiLabView } from './components/AiLabView';

export function AiLabTitlebar() {
  return <Titlebar />;
}

export function AiLabMainPanel() {
  return <AiLabView />;
}

export const aiLabView = {
  TitlebarSlot: AiLabTitlebar,
  MainPanel: AiLabMainPanel,
};
