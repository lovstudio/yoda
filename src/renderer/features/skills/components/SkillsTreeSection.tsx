import {
  ChartNoAxesColumn,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  Power,
  PowerOff,
} from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { SkillFamily } from '@shared/skills/grouping';
import type { CatalogSkill, SkillUsageStat } from '@shared/skills/types';
import { Button } from '@renderer/lib/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@renderer/lib/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { buildSkillTree } from '../skill-tree';
import SkillFamilyCount from './SkillFamilyCount';
import SkillUsageSummary from './SkillUsageSummary';

const registryGrid =
  'grid grid-cols-[minmax(0,1fr)_7.75rem_1.5rem] @2xl:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)_7.75rem_1.5rem]';

interface SkillsTreeSectionProps {
  /** Pre-sorted skills; tree grouping preserves this order. */
  skills: CatalogSkill[];
  /** 'count' reorders entries by group member count descending. */
  orderBy: 'position' | 'count';
  lookupUsage: (skill: CatalogSkill) => SkillUsageStat | undefined;
  familiesByPrimaryKey: ReadonlyMap<string, SkillFamily>;
  onSelect: (skill: CatalogSkill) => void;
  onInstall: (skillKey: string) => void;
  onSetDisabledBatch: (skillKeys: string[], disabled: boolean) => Promise<boolean>;
  setSkillRef: (skillKey: string) => (node: HTMLDivElement | null) => void;
  highlightedSkillId: string | null;
}

/** Tree layout: skills grouped by their first name segment (brand/author). */
const SkillsTreeSection: React.FC<SkillsTreeSectionProps> = ({
  skills,
  orderBy,
  lookupUsage,
  familiesByPrimaryKey,
  onSelect,
  onInstall,
  onSetDisabledBatch,
  setSkillRef,
  highlightedSkillId,
}) => {
  const entries = React.useMemo(() => buildSkillTree(skills, orderBy), [skills, orderBy]);

  return (
    <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70 bg-background">
      {entries.map((entry) =>
        entry.kind === 'leaf' ? (
          <SkillTreeRow
            key={entry.skill.key}
            skill={entry.skill}
            family={familiesByPrimaryKey.get(entry.skill.key)}
            usage={lookupUsage(entry.skill)}
            onSelect={onSelect}
            onInstall={onInstall}
            setSkillRef={setSkillRef}
            highlighted={highlightedSkillId === entry.skill.key}
            nested={false}
          />
        ) : (
          <SkillTreeGroup
            key={entry.prefix}
            prefix={entry.prefix}
            skills={entry.skills}
            lookupUsage={lookupUsage}
            familiesByPrimaryKey={familiesByPrimaryKey}
            onSelect={onSelect}
            onInstall={onInstall}
            onSetDisabledBatch={onSetDisabledBatch}
            setSkillRef={setSkillRef}
            highlightedSkillId={highlightedSkillId}
          />
        )
      )}
    </div>
  );
};

interface SkillTreeGroupProps extends Omit<SkillsTreeSectionProps, 'skills' | 'orderBy'> {
  prefix: string;
  skills: CatalogSkill[];
}

const SkillTreeGroup: React.FC<SkillTreeGroupProps> = ({
  prefix,
  skills,
  lookupUsage,
  familiesByPrimaryKey,
  onSelect,
  onInstall,
  onSetDisabledBatch,
  setSkillRef,
  highlightedSkillId,
}) => {
  const [open, setOpen] = React.useState(true);
  const [updating, setUpdating] = React.useState(false);
  const { t } = useTranslation();
  const groupTotal = skills.reduce((sum, skill) => sum + (lookupUsage(skill)?.total ?? 0), 0);
  const editableSkills = skills.filter((skill) => skill.installed && skill.scope !== 'plugin');
  const allDisabled = editableSkills.length > 0 && editableSkills.every((skill) => skill.disabled);
  const targetDisabled = !allDisabled;
  const actionLabel = t(targetDisabled ? 'skills.groupDisableAria' : 'skills.groupEnableAria', {
    name: prefix,
    count: editableSkills.length,
  });
  const updateGroup = async () => {
    setUpdating(true);
    try {
      await onSetDisabledBatch(
        editableSkills.map((skill) => skill.key),
        targetDisabled
      );
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          registryGrid,
          'group min-h-10 items-center gap-x-3 bg-background-1/55 px-3 transition-colors hover:bg-muted/45'
        )}
      >
        <CollapsibleTrigger className="col-span-1 flex min-w-0 items-center gap-2 self-stretch text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border @2xl:col-span-2">
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-foreground-muted transition-transform',
              open && 'rotate-90'
            )}
          />
          <span className="truncate text-[13px] font-semibold text-foreground">{prefix}</span>
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-foreground-muted">
            {skills.length}
          </span>
        </CollapsibleTrigger>
        <span className="flex w-[7.75rem] items-center justify-end gap-1 text-[11px] tabular-nums text-foreground-muted">
          {groupTotal > 0 && (
            <>
              <ChartNoAxesColumn className="h-3 w-3" />
              {groupTotal}
            </>
          )}
        </span>
        {editableSkills.length > 0 && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={actionLabel}
                  disabled={updating}
                  onClick={() => void updateGroup()}
                />
              }
            >
              {updating ? (
                <Loader2 className="animate-spin" />
              ) : targetDisabled ? (
                <PowerOff />
              ) : (
                <Power />
              )}
            </TooltipTrigger>
            <TooltipContent>{actionLabel}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <CollapsibleContent>
        <div className="divide-y divide-border/50 border-t border-border/60 bg-background">
          {skills.map((skill) => (
            <SkillTreeRow
              key={skill.key}
              skill={skill}
              family={familiesByPrimaryKey.get(skill.key)}
              usage={lookupUsage(skill)}
              onSelect={onSelect}
              onInstall={onInstall}
              setSkillRef={setSkillRef}
              highlighted={highlightedSkillId === skill.key}
              nested
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

interface SkillTreeRowProps {
  skill: CatalogSkill;
  family?: SkillFamily;
  usage: SkillUsageStat | undefined;
  onSelect: (skill: CatalogSkill) => void;
  onInstall: (skillKey: string) => void;
  setSkillRef: (skillKey: string) => (node: HTMLDivElement | null) => void;
  highlighted: boolean;
  nested: boolean;
}

const SkillTreeRow: React.FC<SkillTreeRowProps> = ({
  skill,
  family,
  usage,
  onSelect,
  onInstall,
  setSkillRef,
  highlighted,
  nested,
}) => {
  const { t } = useTranslation();
  const description = skill.description || skill.frontmatter.description || '';

  return (
    <div
      ref={setSkillRef(skill.key)}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(skill)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(skill);
        }
      }}
      title={description}
      className={cn(
        registryGrid,
        'group min-h-10 scroll-mt-20 cursor-pointer items-center gap-x-3 px-3 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border',
        nested && 'bg-background-1/15',
        highlighted && 'ring-2 ring-inset ring-amber-400'
      )}
    >
      <span className={cn('flex min-w-0 items-center gap-2', nested && 'pl-6')}>
        <span
          className={cn(
            'min-w-0 truncate text-[13px] font-medium text-foreground',
            skill.disabled && 'text-muted-foreground line-through decoration-border'
          )}
        >
          {skill.displayName}
        </span>
        {family && <SkillFamilyCount family={family} />}
        {skill.disabled && <PowerOff className="h-3 w-3 shrink-0 text-foreground-muted" />}
      </span>
      <span className="hidden min-w-0 truncate text-xs text-foreground-muted @2xl:block">
        {description || t('skills.noDescription')}
      </span>
      <span className="flex w-[7.75rem] justify-end">
        {usage && usage.total > 0 && (
          <SkillUsageSummary usage={usage} className="w-full justify-end" />
        )}
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={t(skill.installed ? 'skills.openDetailsAria' : 'skills.installAria', {
                name: skill.displayName,
              })}
              onClick={(event) => {
                event.stopPropagation();
                if (skill.installed) {
                  onSelect(skill);
                } else {
                  onInstall(skill.key);
                }
              }}
            />
          }
        >
          {skill.installed ? <Pencil /> : <Plus />}
        </TooltipTrigger>
        <TooltipContent>
          {t(skill.installed ? 'skills.openDetails' : 'skills.install')}
        </TooltipContent>
      </Tooltip>
    </div>
  );
};

export default SkillsTreeSection;
