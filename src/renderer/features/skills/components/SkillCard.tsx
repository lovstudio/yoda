import { motion } from 'framer-motion';
import { AlertTriangle, ChartNoAxesColumn, FileText, Pencil, Plus, PowerOff } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CatalogSkill, SkillUsageStat, SkillValidationIssue } from '@shared/skills/types';
import { parseFrontmatter, skillIssueAgentLabel } from '@shared/skills/validation';
import { openProjectFileTab } from '@renderer/features/project-file/project-file-session';
import { FilePathMenuItems } from '@renderer/lib/components/file-path-actions';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { cn } from '@renderer/utils/utils';
import { skillFilePath } from '../skill-file-path';
import SkillIconRenderer from './SkillIconRenderer';

interface SkillCardProps {
  skill: CatalogSkill;
  /** Real invocation stats from skillusage; undefined when unavailable/unused */
  usage?: SkillUsageStat;
  onSelect: (skill: CatalogSkill) => void;
  onInstall: (skillId: string) => void;
}

const SkillCard: React.FC<SkillCardProps> = ({ skill, usage, onSelect, onInstall }) => {
  const { t } = useTranslation();
  const description = React.useMemo(() => getDisplayDescription(skill), [skill]);
  const primaryIssue = skill.validationIssues?.[0];
  const hasValidationIssues = Boolean(primaryIssue);

  const card = (
    <motion.div
      role="button"
      tabIndex={0}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.1, ease: 'easeInOut' }}
      onClick={() => onSelect(skill)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(skill);
        }
      }}
      className={cn(
        'group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-muted/20 p-4 text-left text-card-foreground shadow-sm transition-all hover:bg-muted/40 hover:shadow-md',
        hasValidationIssues &&
          'border-amber-500/40 bg-amber-500/5 hover:border-amber-500/60 hover:bg-amber-500/10'
      )}
    >
      <SkillIconRenderer skill={skill} />

      {/* Content */}
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold">{skill.displayName}</h3>
        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground" title={description}>
          {description}
        </p>
        {skill.disabled && (
          <p className="mt-1 flex min-w-0 items-center gap-1 text-[11px] leading-tight text-muted-foreground">
            <PowerOff className="h-3 w-3 shrink-0" />
            <span className="truncate">{t('skills.disabled')}</span>
          </p>
        )}
        {primaryIssue && (
          <p
            className="mt-1 flex min-w-0 items-center gap-1 text-[11px] leading-tight text-amber-600 dark:text-amber-400"
            title={formatValidationIssueTitle(primaryIssue)}
          >
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="truncate">{formatValidationIssueSummary(primaryIssue)}</span>
          </p>
        )}
      </div>

      {/* Usage / edit affordance — for installed skills the hover pen swaps
          into the stat slot in place (stacked grid keeps the width stable) */}
      {(skill.installed || (usage && usage.total > 0)) && (
        <div className="grid shrink-0 place-items-center self-center">
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
            <Pencil className="col-start-1 row-start-1 h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </div>
      )}
      {!skill.installed && (
        <div className="shrink-0 self-center">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onInstall(skill.id);
            }}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={`Install ${skill.displayName}`}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      )}
    </motion.div>
  );

  // A skill on disk is a folder — give it the standard file context menu.
  if (!skill.localPath) return card;
  const mdPath = skillFilePath(skill.localPath, skill.disabled);
  return (
    <ContextMenu>
      <ContextMenuTrigger className="block w-full min-w-0">{card}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={() => openProjectFileTab(null, mdPath)}>
          <FileText className="size-4" />
          {t('fileActions.openInMainArea')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <FilePathMenuItems
          target={{ absolutePath: skill.localPath, kind: 'directory' }}
          components={{ Item: ContextMenuItem, Separator: ContextMenuSeparator }}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
};

function getDisplayDescription(skill: CatalogSkill): string {
  if (skill.skillMdContent) {
    const parsedDescription = parseFrontmatter(skill.skillMdContent).frontmatter.description;
    if (parsedDescription && !isYamlBlockMarker(parsedDescription)) return parsedDescription;
  }

  const description = skill.description || skill.frontmatter.description || '';
  return isYamlBlockMarker(description) ? '' : description;
}

function isYamlBlockMarker(value: string): boolean {
  return /^[>|][+-]?$/.test(value.trim());
}

function formatValidationIssueSummary(issue: SkillValidationIssue): string {
  return `${skillIssueAgentLabel(issue.agent)}: ${issue.message}`;
}

function formatValidationIssueTitle(issue: SkillValidationIssue): string {
  return issue.path
    ? `${skillIssueAgentLabel(issue.agent)}: ${issue.path}: ${issue.message}`
    : formatValidationIssueSummary(issue);
}

export default SkillCard;
