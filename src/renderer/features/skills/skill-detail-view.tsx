import type { PropsWithChildren } from 'react';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import SkillDetailPanel from './components/SkillDetailPanel';

type SkillDetailViewParams = {
  skillId: string;
  /** Display-only tab label; tab identity keys on skillId (see routeKey). */
  displayName?: string;
};

export function SkillDetailTitlebar() {
  return <Titlebar />;
}

export function SkillDetailWrapView({ children }: PropsWithChildren<SkillDetailViewParams>) {
  return <>{children}</>;
}

export function SkillDetailMainPanel() {
  const {
    params: { skillId },
  } = useParams('skill');
  if (!skillId) return null;
  return <SkillDetailPanel key={skillId} skillId={skillId} />;
}

export const skillDetailView = {
  WrapView: SkillDetailWrapView,
  TitlebarSlot: SkillDetailTitlebar,
  MainPanel: SkillDetailMainPanel,
};
