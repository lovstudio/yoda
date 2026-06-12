import {
  ArrowDownWideNarrow,
  LayoutGrid,
  ListTree,
  Loader2,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CatalogSkill } from '@shared/skills/types';
import { useOpenViewTab, useParams } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { cn } from '@renderer/utils/utils';
import { SKILL_SORT_MODES, sortSkills, type SkillSortMode } from '../skill-sort';
import SkillCard from './SkillCard';
import SkillsCatalogHint from './SkillsCatalogHint';
import SkillsTreeSection from './SkillsTreeSection';
import { useSkills } from './useSkills';
import { useSkillUsage } from './useSkillUsage';

type SkillsLayout = 'grid' | 'tree';

const LAYOUT_STORAGE_KEY = 'yoda.skillsLayout';

function loadStoredLayout(): SkillsLayout {
  try {
    return window.localStorage.getItem(LAYOUT_STORAGE_KEY) === 'tree' ? 'tree' : 'grid';
  } catch {
    return 'grid';
  }
}

const SkillsView: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { t } = useTranslation();
  const { params: skillsParams, setParams: setSkillsParams } = useParams('skills');
  const {
    catalog,
    isLoading,
    isRefreshing,
    searchQuery,
    setSearchQuery,
    installedSkills,
    recommendedSkills,
    refresh,
    install,
  } = useSkills();
  const { usage, lookupUsage } = useSkillUsage();
  const [sortMode, setSortMode] = React.useState<SkillSortMode>('name');
  const [layout, setLayout] = React.useState<SkillsLayout>(loadStoredLayout);
  const usageAvailable = usage !== null && Object.keys(usage.bySkill).length > 0;

  const switchLayout = React.useCallback((value: SkillsLayout) => {
    setLayout(value);
    // 'count' is a tree-only group order; fall back when returning to cards.
    if (value === 'grid') setSortMode((mode) => (mode === 'count' ? 'name' : mode));
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, value);
    } catch {
      // Persistence is best-effort.
    }
  }, []);

  // 'name' and the length rankings always work; 'count' needs the tree;
  // usage modes need stats.
  const visibleSortModes = React.useMemo(
    () =>
      SKILL_SORT_MODES.filter((mode) => {
        if (mode === 'count') return layout === 'tree';
        if (mode === 'name' || mode === 'trigger' || mode === 'body') return true;
        return usageAvailable;
      }),
    [layout, usageAvailable]
  );

  const sortedInstalledSkills = React.useMemo(
    () => sortSkills(installedSkills, sortMode, lookupUsage),
    [installedSkills, sortMode, lookupUsage]
  );
  const sortedRecommendedSkills = React.useMemo(
    () => sortSkills(recommendedSkills, sortMode, lookupUsage),
    [recommendedSkills, sortMode, lookupUsage]
  );

  const showCreateSkillModal = useShowModal('createSkillModal');
  const focusedSkillId =
    typeof skillsParams.focusSkillId === 'string' ? skillsParams.focusSkillId : undefined;
  const skillCardRefs = React.useRef(new Map<string, HTMLDivElement>());
  const [highlightedSkillId, setHighlightedSkillId] = React.useState<string | null>(null);

  const setSkillCardRef = React.useCallback(
    (skillId: string) => (node: HTMLDivElement | null) => {
      if (node) {
        skillCardRefs.current.set(skillId, node);
      } else {
        skillCardRefs.current.delete(skillId);
      }
    },
    []
  );

  // Skill click opens (or focuses) the detail as a tab of the hosting surface:
  // a side-pane pin when this view is pin-hosted, a top-level app tab otherwise.
  const { openViewTab } = useOpenViewTab();
  const openDetail = (skill: CatalogSkill) => {
    openViewTab('skill', { skillId: skill.id, displayName: skill.displayName });
  };

  React.useEffect(() => {
    if (!focusedSkillId || isLoading) return;

    const isVisible =
      installedSkills.some((skill) => skill.id === focusedSkillId) ||
      recommendedSkills.some((skill) => skill.id === focusedSkillId);
    const existsInCatalog = catalog?.skills.some((skill) => skill.id === focusedSkillId) ?? false;

    if (!isVisible && existsInCatalog && searchQuery) {
      setSearchQuery('');
      return;
    }

    const node = skillCardRefs.current.get(focusedSkillId);
    if (!node) return;

    const frame = window.requestAnimationFrame(() => {
      node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setHighlightedSkillId(focusedSkillId);
      setSkillsParams(() => ({}));
    });
    const timeout = window.setTimeout(() => {
      setHighlightedSkillId((current) => (current === focusedSkillId ? null : current));
    }, 2400);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [
    catalog?.skills,
    focusedSkillId,
    installedSkills,
    isLoading,
    recommendedSkills,
    searchQuery,
    setSearchQuery,
    setSkillsParams,
  ]);

  if (isLoading) {
    return (
      <div
        className={cn(
          'flex items-center justify-center bg-background text-foreground',
          embedded ? 'h-48' : 'h-full'
        )}
      >
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        '@container flex flex-col bg-background text-foreground',
        !embedded && 'h-full overflow-y-auto'
      )}
    >
      <div className={cn('w-full', !embedded && 'mx-auto max-w-3xl px-8 py-8')}>
        {/* Header */}
        {!embedded && (
          <div className="mb-6">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">{t('skills.title')}</h1>
              <SkillsCatalogHint />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t('skills.subtitle')}</p>
          </div>
        )}

        {/* Toolbar */}
        <div
          className={cn(
            'sticky top-0 z-20 mb-6 flex items-center gap-2 border-b border-border/60 bg-background/95 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80',
            !embedded && '-mx-8 px-8'
          )}
        >
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t('skills.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <ToggleGroup
            size="icon-sm"
            multiple={false}
            value={[layout]}
            onValueChange={([value]) => {
              if (value) switchLayout(value as SkillsLayout);
            }}
            aria-label={t('skills.layout.ariaLabel')}
          >
            <ToggleGroupItem value="grid" aria-label={t('skills.layout.grid')}>
              <LayoutGrid className="h-3.5 w-3.5" />
            </ToggleGroupItem>
            <ToggleGroupItem value="tree" aria-label={t('skills.layout.tree')}>
              <ListTree className="h-3.5 w-3.5" />
            </ToggleGroupItem>
          </ToggleGroup>
          {visibleSortModes.length > 1 && (
            <Select value={sortMode} onValueChange={(value) => setSortMode(value as SkillSortMode)}>
              <SelectTrigger
                className="w-auto shrink-0 gap-1.5 text-xs text-muted-foreground"
                aria-label={t('skills.sort.ariaLabel')}
              >
                <ArrowDownWideNarrow className="h-3.5 w-3.5 shrink-0" />
                {/* Narrow containers keep the icon-only trigger */}
                <span className="hidden @xl:contents">
                  <SelectValue />
                </span>
              </SelectTrigger>
              <SelectContent align="end">
                {visibleSortModes.map((mode) => (
                  <SelectItem key={mode} value={mode} className="text-xs">
                    {t(`skills.sort.${mode}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            disabled={isRefreshing}
            aria-label={t('skills.refreshAria')}
          >
            <RefreshCw
              className={`h-4 w-4 text-muted-foreground ${isRefreshing ? 'animate-spin' : ''}`}
            />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => showCreateSkillModal({})}
            aria-label={t('skills.newSkill')}
            className="shrink-0"
          >
            <Plus className="h-3.5 w-3.5 @xl:mr-1.5" />
            {/* Narrow containers collapse to the icon */}
            <span className="hidden @xl:inline">{t('skills.newSkill')}</span>
          </Button>
        </div>

        {(
          [
            ['skills.installed', sortedInstalledSkills],
            ['skills.recommended', sortedRecommendedSkills],
          ] as const
        ).map(
          ([titleKey, skills]) =>
            skills.length > 0 && (
              <div key={titleKey} className="mb-6">
                <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">
                  {t(titleKey)}
                </h2>
                {layout === 'tree' ? (
                  <SkillsTreeSection
                    skills={skills}
                    orderBy={sortMode === 'count' ? 'count' : 'position'}
                    lookupUsage={lookupUsage}
                    onSelect={openDetail}
                    onInstall={install}
                    setSkillRef={setSkillCardRef}
                    highlightedSkillId={highlightedSkillId}
                  />
                ) : (
                  <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
                    {skills.map((skill) => (
                      <div
                        key={skill.id}
                        ref={setSkillCardRef(skill.id)}
                        className={cn(
                          'scroll-mt-20 rounded-lg transition-shadow duration-300',
                          highlightedSkillId === skill.id &&
                            'ring-2 ring-amber-400 ring-offset-2 ring-offset-background'
                        )}
                      >
                        <SkillCard
                          skill={skill}
                          usage={lookupUsage(skill.id)}
                          onSelect={openDetail}
                          onInstall={install}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
        )}

        {installedSkills.length === 0 && recommendedSkills.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {searchQuery ? t('skills.noMatches') : t('skills.noSkills')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default SkillsView;
