import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Blocks,
  Check,
  CornerDownLeft,
  Download,
  ExternalLink,
  Loader2,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { applyAgentCommandPrefix } from '@shared/agent-command-prefix';
import type { RuntimeId } from '@shared/runtime-registry';
import type { CatalogSkill, ClawHubSkillSearchResult } from '@shared/skills/types';
import {
  WorkspaceBarCardHeader,
  WorkspaceBarCardMenu,
  WorkspaceBarCardSection,
} from '@renderer/app/workspace-bar-card';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { DropdownMenuItem } from '@renderer/lib/ui/dropdown-menu';
import { HighlightedText, windowAroundMatch } from '@renderer/lib/ui/highlighted-text';
import { Input } from '@renderer/lib/ui/input';
import { cn } from '@renderer/utils/utils';
import { filterInstalledSkills, hasInstalledRuntimeName } from '../skill-quick-search';
import { skillsQuickCatalogQueryOptions } from '../skills-query';
import SkillIconRenderer from './SkillIconRenderer';

interface SkillQuickSearchPopoverProps {
  onInstalled: (skill: CatalogSkill) => void;
  onManageSkills: () => void;
  /** Stages the skill's command in the session input, without submitting it. */
  onInsertSkill: (skill: CatalogSkill) => void;
  /** Decides the command prefix shown on each row (`/` for Claude, `$` for Codex). */
  runtimeId?: RuntimeId | null;
}

type ExternalSearchState = {
  query: string;
  results: ClawHubSkillSearchResult[];
};

const MAX_VISIBLE_LOCAL_SKILLS = 40;
const LOCAL_OPTION_ID_PREFIX = 'local-skill-option-';

export function SkillQuickSearchPopover({
  onInstalled,
  onManageSkills,
  onInsertSkill,
  runtimeId = null,
}: SkillQuickSearchPopoverProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [externalSearch, setExternalSearch] = useState<ExternalSearchState | null>(null);
  const normalizedQuery = query.trim();
  const { data: catalog, isPending: isLoading } = useQuery(skillsQuickCatalogQueryOptions);
  const localResults = useMemo(
    () => filterInstalledSkills(catalog?.skills ?? [], normalizedQuery),
    [catalog?.skills, normalizedQuery]
  );
  const visibleLocalResults = useMemo(
    () => localResults.slice(0, MAX_VISIBLE_LOCAL_SKILLS),
    [localResults]
  );
  // Clamped on read: the catalog can shrink under the cursor (a query narrows the
  // list) and a stale index would point at a row that is no longer rendered.
  const activeRow =
    visibleLocalResults.length > 0 ? Math.min(activeIndex, visibleLocalResults.length - 1) : -1;
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  const currentExternalResults =
    externalSearch?.query === normalizedQuery ? externalSearch.results : null;

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeRow]);

  const searchMutation = useMutation({
    mutationFn: async (searchQuery: string) => {
      const result = await rpc.skills.searchClawHub({ query: searchQuery, limit: 20 });
      if (!result.success) throw new Error(result.error ?? 'Could not search ClawHub');
      return result.data ?? [];
    },
    onSuccess: (results, searchQuery) => {
      setExternalSearch({ query: searchQuery, results });
    },
  });

  const installMutation = useMutation({
    mutationFn: async (externalSkill: ClawHubSkillSearchResult) => {
      const result = await rpc.skills.installClawHub({
        slug: externalSkill.slug,
        ownerHandle: externalSkill.ownerHandle,
      });
      if (!result.success || !result.data) {
        throw new Error(result.error ?? 'Could not install skill');
      }
      return result.data;
    },
    onSuccess: (skill) => {
      void queryClient.invalidateQueries({ queryKey: ['skills'] });
      toast.success(t('skills.quickSearch.installSuccess', { name: skill.displayName }), {
        description: t('skills.quickSearch.installLocation', {
          path: skill.localPath ?? '~/.agents/skills',
        }),
      });
      onInstalled(skill);
    },
    onError: (error) => {
      toast.error(t('skills.quickSearch.installFailed'), {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const canSearchExternal = Boolean(normalizedQuery && localResults.length === 0);
  const searchIsCurrent = searchMutation.isPending && searchMutation.variables === normalizedQuery;
  const searchErrorIsCurrent =
    searchMutation.isError && searchMutation.variables === normalizedQuery;

  const runExternalSearch = () => {
    if (!canSearchExternal || searchIsCurrent) return;
    searchMutation.mutate(normalizedQuery);
  };

  const moveActiveRow = (delta: number) => {
    if (visibleLocalResults.length === 0) return;
    setActiveIndex((current) => {
      const from = Math.min(current, visibleLocalResults.length - 1);
      return (from + delta + visibleLocalResults.length) % visibleLocalResults.length;
    });
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // While an IME is composing, Enter accepts the candidate and the arrows walk
    // the candidate list — none of it belongs to the result list.
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (visibleLocalResults.length === 0) return;
      event.preventDefault();
      moveActiveRow(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key !== 'Enter') return;
    const activeSkill = activeRow >= 0 ? visibleLocalResults[activeRow] : undefined;
    if (activeSkill) {
      event.preventDefault();
      onInsertSkill(activeSkill);
      return;
    }
    if (canSearchExternal) runExternalSearch();
  };

  return (
    <div className="flex min-h-0 flex-col">
      <WorkspaceBarCardHeader
        icon={Blocks}
        title={t('skills.quickSearch.title')}
        description={t('skills.quickSearch.description')}
        actions={
          <WorkspaceBarCardMenu>
            <DropdownMenuItem onClick={onManageSkills}>
              <SlidersHorizontal aria-hidden />
              {t('skills.quickSearch.manageAll')}
            </DropdownMenuItem>
          </WorkspaceBarCardMenu>
        }
      />
      <WorkspaceBarCardSection>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-foreground-passive"
          />
          <Input
            autoFocus
            aria-activedescendant={
              activeRow >= 0 ? `${LOCAL_OPTION_ID_PREFIX}${activeRow}` : undefined
            }
            aria-controls="local-skills-list"
            aria-label={t('skills.quickSearch.searchAria')}
            className="pl-8"
            placeholder={t('skills.quickSearch.placeholder')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleSearchKeyDown}
          />
        </div>
      </WorkspaceBarCardSection>

      <div className="min-h-0 max-h-[28rem] overflow-y-auto">
        <section aria-labelledby="local-skills-heading" className="p-2">
          <div className="flex items-center justify-between px-1.5 pb-1.5 pt-0.5">
            <h3
              id="local-skills-heading"
              className="text-[10px] font-medium uppercase tracking-wide text-foreground-passive"
            >
              {t('skills.quickSearch.localTitle')}
            </h3>
            {!isLoading ? (
              <span className="text-[10px] tabular-nums text-foreground-passive">
                {t('skills.quickSearch.resultCount', { count: localResults.length })}
              </span>
            ) : null}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-foreground-passive">
              <Loader2 className="size-4 animate-spin" />
              {t('skills.quickSearch.loadingLocal')}
            </div>
          ) : visibleLocalResults.length > 0 ? (
            <>
              <div className="space-y-0.5" id="local-skills-list" role="listbox">
                {visibleLocalResults.map((skill, index) => {
                  const command = runtimeId ? applyAgentCommandPrefix(runtimeId, skill.id) : null;
                  const isActive = index === activeRow;
                  return (
                    <button
                      key={skill.key}
                      ref={isActive ? activeRowRef : undefined}
                      aria-label={t('skills.quickSearch.insertAria', { name: skill.displayName })}
                      aria-selected={isActive}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-background-2',
                        isActive && 'bg-background-2'
                      )}
                      id={`${LOCAL_OPTION_ID_PREFIX}${index}`}
                      role="option"
                      type="button"
                      onClick={() => onInsertSkill(skill)}
                      onPointerMove={() => setActiveIndex(index)}
                    >
                      <SkillIconRenderer skill={skill} size="xs" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <HighlightedText
                            className="truncate text-xs font-medium text-foreground"
                            query={normalizedQuery}
                            text={skill.displayName}
                          />
                          {skill.disabled ? (
                            <span className="shrink-0 rounded bg-background-2 px-1 py-0.5 text-[9px] text-foreground-passive">
                              {t('skills.disabled')}
                            </span>
                          ) : null}
                        </div>
                        {/* Descriptions run long, so a match late in one would sit past
                            the truncation and the row would read as an unexplained hit. */}
                        <p className="truncate text-[11px] text-foreground-passive">
                          <HighlightedText
                            query={normalizedQuery}
                            text={windowAroundMatch(skill.description || skill.id, normalizedQuery)}
                          />
                        </p>
                      </div>
                      {command ? (
                        // Also highlighted: a skill whose id differs from its display
                        // name can match here and nowhere else on the row.
                        <HighlightedText
                          className="shrink-0 truncate font-mono text-[10px] text-foreground-passive"
                          query={normalizedQuery}
                          text={command}
                        />
                      ) : null}
                      {isActive ? (
                        <CornerDownLeft
                          aria-hidden
                          className="size-3.5 shrink-0 text-foreground-muted"
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {localResults.length > visibleLocalResults.length ? (
                <p className="px-2 pb-1 pt-2 text-[10px] text-foreground-passive">
                  {t('skills.quickSearch.moreLocalHint')}
                </p>
              ) : null}
              <p className="px-2 pb-1 pt-2 text-[10px] text-foreground-passive">
                {t('skills.quickSearch.insertHint')}
              </p>
            </>
          ) : (
            <div className="rounded-md border border-dashed border-border px-3 py-4 text-center">
              <p className="text-xs text-foreground-muted">
                {normalizedQuery
                  ? t('skills.quickSearch.noLocalResults', { query: normalizedQuery })
                  : t('skills.quickSearch.noLocalSkills')}
              </p>
              {canSearchExternal ? (
                <>
                  <p className="mt-1 text-[11px] text-foreground-passive">
                    {t('skills.quickSearch.externalHint')}
                  </p>
                  <Button
                    className="mt-3 w-full"
                    disabled={searchIsCurrent}
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={runExternalSearch}
                  >
                    {searchIsCurrent ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Search className="size-3.5" />
                    )}
                    {searchIsCurrent
                      ? t('skills.quickSearch.searchingExternal')
                      : t('skills.quickSearch.searchExternal', { query: normalizedQuery })}
                  </Button>
                </>
              ) : null}
            </div>
          )}
        </section>

        {searchErrorIsCurrent ? (
          <div className="mx-2 mb-2 rounded-md border border-border-destructive bg-background-destructive p-3">
            <p className="text-xs text-foreground-destructive">
              {t('skills.quickSearch.externalSearchFailed')}
            </p>
            <Button
              className="mt-2"
              size="xs"
              type="button"
              variant="outline"
              onClick={runExternalSearch}
            >
              {t('common.retry')}
            </Button>
          </div>
        ) : null}

        {currentExternalResults ? (
          <section aria-labelledby="external-skills-heading" className="border-t border-border p-2">
            <div className="flex items-center justify-between px-1.5 pb-1.5 pt-0.5">
              <h3
                id="external-skills-heading"
                className="text-[10px] font-medium uppercase tracking-wide text-foreground-passive"
              >
                {t('skills.quickSearch.externalTitle')}
              </h3>
              <span className="text-[10px] tabular-nums text-foreground-passive">
                {t('skills.quickSearch.resultCount', { count: currentExternalResults.length })}
              </span>
            </div>
            {currentExternalResults.length > 0 ? (
              <div className="space-y-1">
                {currentExternalResults.map((skill) => {
                  const installed = hasInstalledRuntimeName(catalog?.skills ?? [], skill.slug);
                  const installing =
                    installMutation.isPending &&
                    installMutation.variables?.slug === skill.slug &&
                    installMutation.variables.ownerHandle === skill.ownerHandle;
                  return (
                    <div
                      key={`${skill.ownerHandle}/${skill.slug}`}
                      className="rounded-md border border-border bg-background-secondary p-2.5"
                    >
                      <div className="flex items-start gap-2.5">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background-2 text-sm font-semibold text-foreground-muted">
                          {skill.displayName.charAt(0).toLocaleUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <a
                              className="truncate text-xs font-medium text-foreground hover:underline"
                              href={skill.sourceUrl}
                              rel="noopener noreferrer"
                              target="_blank"
                            >
                              <HighlightedText query={normalizedQuery} text={skill.displayName} />
                            </a>
                            <ExternalLink className="size-3 shrink-0 text-foreground-passive" />
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-foreground-passive">
                            <HighlightedText
                              query={normalizedQuery}
                              text={skill.description || t('skills.quickSearch.noDescription')}
                            />
                          </p>
                          <div className="mt-1 text-[10px] text-foreground-passive">
                            @{skill.ownerHandle}
                            {skill.downloads != null
                              ? ` · ${t('skills.quickSearch.downloads', { count: skill.downloads })}`
                              : ''}
                          </div>
                        </div>
                        <Button
                          className={cn(installed && 'text-emerald-600 dark:text-emerald-400')}
                          disabled={installed || installing || installMutation.isPending}
                          size="xs"
                          type="button"
                          variant="outline"
                          onClick={() => installMutation.mutate(skill)}
                        >
                          {installing ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : installed ? (
                            <Check className="size-3" />
                          ) : (
                            <Download className="size-3" />
                          )}
                          {installing
                            ? t('skills.quickSearch.installing')
                            : installed
                              ? t('skills.installed')
                              : t('skills.quickSearch.install')}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-border px-3 py-5 text-center text-xs text-foreground-passive">
                {t('skills.quickSearch.noExternalResults')}
              </p>
            )}
            <p className="px-1.5 pb-1 pt-2 text-[10px] leading-relaxed text-foreground-passive">
              {t('skills.quickSearch.thirdPartyNotice')}
            </p>
          </section>
        ) : null}
      </div>
    </div>
  );
}
