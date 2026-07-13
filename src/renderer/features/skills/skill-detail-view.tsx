import type { PropsWithChildren } from 'react';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import SkillDetailPanel from './components/SkillDetailPanel';

type SkillDetailViewParams = {
  skillId: string;
  /** Display-only tab label; `skillId` carries the opaque stable skill key. */
  displayName?: string;
  /** Catalog tab that opened this detail; keeps the adjacent list in context. */
  catalogSection?: 'installed' | 'recommended' | 'attention';
};

export function SkillDetailTitlebar() {
  return <Titlebar />;
}

export function SkillDetailWrapView({ children }: PropsWithChildren<SkillDetailViewParams>) {
  return <>{children}</>;
}

export function SkillDetailMainPanel() {
  const {
    params: { skillId, catalogSection },
  } = useParams('skill');
  if (!skillId) return null;
  return <SkillDetailPanel skillKey={skillId} catalogSection={catalogSection} />;
}

export const skillDetailView = {
  WrapView: SkillDetailWrapView,
  TitlebarSlot: SkillDetailTitlebar,
  MainPanel: SkillDetailMainPanel,
};
