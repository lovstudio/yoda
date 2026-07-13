import { ChartNoAxesColumn, ChevronRight, Pencil, Plus, PowerOff } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { SkillFamily } from '@shared/skills/grouping';
import type { CatalogSkill, SkillUsageStat } from '@shared/skills/types';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@renderer/lib/ui/collapsible';
import { cn } from '@renderer/utils/utils';
import { buildSkillTree } from '../skill-tree';
import SkillFamilyCount from './SkillFamilyCount';

interface SkillsTreeSectionProps {
  /** Pre-sorted skills; tree grouping preserves this order. */
  skills: CatalogSkill[];
  /** 'count' reorders entries by group member count descending. */
  orderBy: 'position' | 'count';
  lookupUsage: (skill: CatalogSkill) => SkillUsageStat | undefined;
  familiesByPrimaryKey: ReadonlyMap<string, SkillFamily>;
  onSelect: (skill: CatalogSkill) => void;
  onInstall: (skillKey: string) => void;
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
  setSkillRef,
  highlightedSkillId,
}) => {
  const entries = React.useMemo(() => buildSkillTree(skills, orderBy), [skills, orderBy]);

  return (
    <div className="flex flex-col gap-0.5">
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
  setSkillRef,
  highlightedSkillId,
}) => {
  const [open, setOpen] = React.useState(true);
  const groupTotal = skills.reduce((sum, skill) => sum + (lookupUsage(skill)?.total ?? 0), 0);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-muted/40">
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90'
          )}
        />
        <span className="truncate text-sm font-medium">{prefix}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {skills.length}
        </span>
        {groupTotal > 0 && (
          <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
            <ChartNoAxesColumn className="h-3 w-3" />
            {groupTotal}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-[1.0625rem] flex flex-col gap-0.5 border-l border-border/60 pl-2">
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
}

const SkillTreeRow: React.FC<SkillTreeRowProps> = ({
  skill,
  family,
  usage,
  onSelect,
  onInstall,
  setSkillRef,
  highlighted,
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
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(skill);
        }
      }}
      title={description}
      className={cn(
        'group flex scroll-mt-20 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/40',
        highlighted && 'ring-2 ring-amber-400 ring-offset-2 ring-offset-background'
      )}
    >
      <span
        className={cn(
          'truncate text-sm',
          skill.disabled ? 'text-muted-foreground line-through decoration-border' : ''
        )}
      >
        {skill.displayName}
      </span>
      {family && <SkillFamilyCount family={family} />}
      {skill.disabled && <PowerOff className="h-3 w-3 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{description}</span>
      {/* Usage / edit affordance — for installed skills the hover pen swaps
          into the stat slot in place (stacked grid keeps the width stable) */}
      {(skill.installed || (usage && usage.total > 0)) && (
        <span className="grid shrink-0 place-items-center">
          {usage && usage.total > 0 && (
            <span
              className={cn(
                'col-start-1 row-start-1 flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground',
                skill.installed && 'transition-opacity group-hover:opacity-0'
              )}
              title={t('skills.usageTitle', { manual: usage.manual, auto: usage.auto })}
            >
              <ChartNoAxesColumn className="h-3 w-3" />
              {usage.total}
            </span>
          )}
          {skill.installed && (
            <Pencil className="col-start-1 row-start-1 h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </span>
      )}
      {!skill.installed && (
        <span className="shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onInstall(skill.key);
            }}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={`Install ${skill.displayName}`}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </span>
      )}
    </div>
  );
};

export default SkillsTreeSection;
