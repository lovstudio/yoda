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
      className={cn('shrink-0 text-[10px] tabular-nums text-muted-foreground', className)}
      title={label}
    >
      {label}
    </span>
  );
};

export default SkillFamilyCount;
