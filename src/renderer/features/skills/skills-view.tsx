import { type PropsWithChildren } from 'react';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import SkillsView from './components/SkillsView';

type SkillsViewParams = {
  focusSkillId?: string;
};

export function SkillsTitlebar() {
  return <Titlebar />;
}

export function SkillsWrapView({ children }: PropsWithChildren<SkillsViewParams>) {
  return <>{children}</>;
}

export function SkillsMainPanel() {
  return <SkillsView />;
}

export const skillsView = {
  WrapView: SkillsWrapView,
  TitlebarSlot: SkillsTitlebar,
  MainPanel: SkillsMainPanel,
};
