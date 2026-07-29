import { ChartNoAxesColumn } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { SkillUsageStat } from '@shared/skills/types';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { cn } from '@renderer/utils/utils';

interface SkillUsageSummaryProps {
  usage: SkillUsageStat;
  className?: string;
}

/** Shared invocation count and last-used metadata for every skill list layout. */
const SkillUsageSummary: React.FC<SkillUsageSummaryProps> = ({ usage, className }) => {
  const { t } = useTranslation();

  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-muted-foreground',
        className
      )}
      title={t('skills.usageTitle', { manual: usage.manual, auto: usage.auto })}
    >
      <ChartNoAxesColumn className="h-3 w-3" />
      <span>{usage.total}</span>
      {usage.lastUsedAt && (
        <>
          <span aria-hidden="true" className="text-border">
            ·
          </span>
          <RelativeTime value={usage.lastUsedAt} compact ago />
        </>
      )}
    </span>
  );
};

export default SkillUsageSummary;
