import { AlertTriangle, ChevronRight, Pencil, Plus, PowerOff } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { SkillFamily } from '@shared/skills/grouping';
import type { CatalogSkill, SkillUsageStat, SkillValidationIssue } from '@shared/skills/types';
import { parseFrontmatter, skillIssueAgentLabel } from '@shared/skills/validation';
import { GlobalFileMenuItems } from '@renderer/lib/components/file-path-actions';
import { Button } from '@renderer/lib/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@renderer/lib/ui/collapsible';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { skillFilePath } from '../skill-file-path';
import { primarySkillHealthIssue } from '../skill-health';
import SkillFamilyCount from './SkillFamilyCount';
import SkillUsageSummary from './SkillUsageSummary';

interface SkillAccordionRowProps {
  skill: CatalogSkill;
  family?: SkillFamily;
  /** Real invocation stats from skillusage; undefined when unavailable/unused */
  usage?: SkillUsageStat;
  onSelect: (skill: CatalogSkill) => void;
  onInstall: (skillKey: string) => void;
}

const SkillAccordionRow: React.FC<SkillAccordionRowProps> = ({
  skill,
  family,
  usage,
  onSelect,
  onInstall,
}) => {
  const { t } = useTranslation();
  const description = React.useMemo(() => getDisplayDescription(skill), [skill]);
  const primaryIssue = skill.validationIssues?.[0];
  const healthIssue = primarySkillHealthIssue(skill);
  const issueMessage = primaryIssue
    ? formatValidationIssueSummary(primaryIssue)
    : healthIssue
      ? t(`skills.health.issue.${healthIssue.code}`, {
          defaultValue: healthIssue.message,
        })
      : null;
  const hasWarning =
    Boolean(primaryIssue) ||
    healthIssue?.severity === 'error' ||
    healthIssue?.severity === 'warning';

  const row = (
    <Collapsible
      className={cn(
        'transition-colors data-[panel-open]:bg-background-1/40',
        hasWarning && 'bg-amber-500/5 data-[panel-open]:bg-amber-500/10'
      )}
    >
      <div className="flex min-w-0 items-center pr-2 transition-colors hover:bg-muted/30">
        <CollapsibleTrigger
          className="group flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border"
          title={description || undefined}
        >
          <ChevronRight
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform group-data-[panel-open]:rotate-90"
            aria-hidden="true"
          />
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span
              className={cn(
                'min-w-0 truncate text-sm font-medium text-foreground',
                skill.disabled && 'text-muted-foreground line-through decoration-border'
              )}
            >
              {skill.displayName}
            </span>
            {family && <SkillFamilyCount family={family} />}
            {skill.disabled && (
              <PowerOff
                className="h-3 w-3 shrink-0 text-muted-foreground"
                aria-label={t('skills.disabled')}
              />
            )}
            {hasWarning && (
              <AlertTriangle
                className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
                aria-label={issueMessage ?? undefined}
              />
            )}
          </span>
          <span className="hidden min-w-0 max-w-64 flex-1 truncate text-xs text-muted-foreground @2xl:block">
            {description || t('skills.noDescription')}
          </span>
          <span className="hidden w-24 shrink-0 truncate text-[9px] font-medium uppercase tracking-wide text-muted-foreground @xl:block">
            {t(`skills.source.${skill.source}`)}
          </span>
          {usage && usage.total > 0 && <SkillUsageSummary usage={usage} />}
        </CollapsibleTrigger>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t(skill.installed ? 'skills.openDetailsAria' : 'skills.installAria', {
                  name: skill.displayName,
                })}
                onClick={() => {
                  if (skill.installed) {
                    onSelect(skill);
                  } else {
                    onInstall(skill.key);
                  }
                }}
              />
            }
          >
            {skill.installed ? (
              <Pencil className="h-3.5 w-3.5" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
          </TooltipTrigger>
          <TooltipContent>
            {t(skill.installed ? 'skills.openDetails' : 'skills.install')}
          </TooltipContent>
        </Tooltip>
      </div>

      <CollapsibleContent>
        <div className="border-t border-border/50 bg-background px-3 py-3 pl-10">
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {description || t('skills.noDescription')}
          </p>
          {issueMessage && (
            <p
              className={cn(
                'mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed',
                healthIssue?.severity === 'info' && !primaryIssue
                  ? 'text-muted-foreground'
                  : 'text-amber-600 dark:text-amber-400'
              )}
              title={primaryIssue ? formatValidationIssueTitle(primaryIssue) : issueMessage}
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{issueMessage}</span>
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-foreground-muted">
            <span>{t(`skills.source.${skill.source}`)}</span>
            {skill.disabled && <span>{t('skills.disabled')}</span>}
            {usage && usage.total > 0 && <SkillUsageSummary usage={usage} />}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );

  // A skill on disk is a file — give it the standard file context menu.
  if (!skill.localPath) return row;
  const mdPath = skillFilePath(skill.localPath, skill.disabled);
  return (
    <ContextMenu>
      <ContextMenuTrigger className="block w-full min-w-0">{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <GlobalFileMenuItems
          absolutePath={mdPath}
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

export default SkillAccordionRow;
