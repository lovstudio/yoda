import React from 'react';
import { useTranslation } from 'react-i18next';
import { skillFamilyLocationCount, type SkillFamily } from '@shared/skills/grouping';
import { cn } from '@renderer/utils/utils';

const SkillFamilyCount: React.FC<{
  family: SkillFamily;
  className?: string;
}> = ({ family, className }) => {
  const { t } = useTranslation();
  const locations = skillFamilyLocationCount(family);
  const parts: string[] = [];
  if (family.variants.length > 1) {
    parts.push(t('skills.family.variants', { count: family.variants.length }));
  }
  if (locations > 1) parts.push(t('skills.family.locations', { count: locations }));
  if (parts.length === 0) return null;

  const label = parts.join(' · ');
  return (
    <span
      className={cn(
        'max-w-36 shrink-0 truncate rounded border border-border/70 bg-background-1 px-1.5 py-0.5 text-[9px] leading-none tabular-nums text-foreground-muted',
        className
      )}
      title={label}
    >
      {label}
    </span>
  );
};

export default SkillFamilyCount;
