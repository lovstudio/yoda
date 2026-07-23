import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Download,
  ExternalLink,
  Loader2,
  Search,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CatalogSkill, ClawHubSkillSearchResult } from '@shared/skills/types';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { cn } from '@renderer/utils/utils';
import { filterInstalledSkills, hasInstalledRuntimeName } from '../skill-quick-search';
import { fetchSkillsCatalog, skillsCatalogQueryKey } from '../skills-query';
import SkillIconRenderer from './SkillIconRenderer';

interface SkillQuickSearchPopoverProps {
  onInstalled: (skill: CatalogSkill) => void;
  onManageSkills: () => void;
}

type ExternalSearchState = {
  query: string;
  results: ClawHubSkillSearchResult[];
};

export function SkillQuickSearchPopover({
  onInstalled,
  onManageSkills,
}: SkillQuickSearchPopoverProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [externalSearch, setExternalSearch] = useState<ExternalSearchState | null>(null);
  const normalizedQuery = query.trim();
  const { data: catalog, isPending: isLoading } = useQuery({
    queryKey: skillsCatalogQueryKey,
    queryFn: fetchSkillsCatalog,
  });
  const localResults = useMemo(
    () => filterInstalledSkills(catalog?.skills ?? [], normalizedQuery),
    [catalog?.skills, normalizedQuery]
  );
  const currentExternalResults =
    externalSearch?.query === normalizedQuery ? externalSearch.results : null;

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

  return (
    <div className="flex min-h-0 flex-col">
      <div className="border-b border-border p-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-foreground-muted" />
          <div>
            <div className="text-sm font-medium">{t('skills.quickSearch.title')}</div>
            <div className="text-[11px] text-foreground-passive">
              {t('skills.quickSearch.description')}
            </div>
          </div>
        </div>
        <div className="relative mt-3">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-foreground-passive"
          />
          <Input
            autoFocus
            aria-label={t('skills.quickSearch.searchAria')}
            className="pl-8"
            placeholder={t('skills.quickSearch.placeholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSearchExternal) runExternalSearch();
            }}
          />
        </div>
      </div>

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
          ) : localResults.length > 0 ? (
            <div className="space-y-0.5">
              {localResults.map((skill) => (
                <div key={skill.key} className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
                  <SkillIconRenderer skill={skill} size="xs" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-medium text-foreground">
                        {skill.displayName}
                      </span>
                      {skill.disabled ? (
                        <span className="shrink-0 rounded bg-background-2 px-1 py-0.5 text-[9px] text-foreground-passive">
                          {t('skills.disabled')}
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-[11px] text-foreground-passive">
                      {skill.description || skill.id}
                    </p>
                  </div>
                  <Check aria-hidden className="size-3.5 shrink-0 text-emerald-500" />
                </div>
              ))}
            </div>
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
                              {skill.displayName}
                            </a>
                            <ExternalLink className="size-3 shrink-0 text-foreground-passive" />
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-foreground-passive">
                            {skill.description || t('skills.quickSearch.noDescription')}
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
      <div className="border-t border-border p-2">
        <Button className="w-full" size="sm" type="button" variant="ghost" onClick={onManageSkills}>
          <SlidersHorizontal className="size-3.5" />
          {t('skills.quickSearch.manageAll')}
        </Button>
      </div>
    </div>
  );
}
