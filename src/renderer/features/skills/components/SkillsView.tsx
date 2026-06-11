import { Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { CatalogSkill } from '@shared/skills/types';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { cn } from '@renderer/utils/utils';
import SkillCard from './SkillCard';
import { useSkills } from './useSkills';

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

  // Skill click opens (or focuses) the detail as a top-level app tab.
  const openDetail = (skill: CatalogSkill) => {
    appState.appTabs.openTab('skill', { skillId: skill.id, displayName: skill.displayName });
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
        'flex flex-col bg-background text-foreground',
        !embedded && 'h-full overflow-y-auto'
      )}
    >
      <div className={cn('w-full', !embedded && 'mx-auto max-w-3xl px-8 py-8')}>
        {/* Header */}
        {!embedded && (
          <div className="mb-6">
            <h1 className="text-lg font-semibold">{t('skills.title')}</h1>
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
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t('skills.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
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
          <Button variant="outline" size="sm" onClick={() => showCreateSkillModal({})}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t('skills.newSkill')}
          </Button>
        </div>

        <div className="mb-4 flex items-start gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            <Trans
              i18nKey="skills.catalogDescription"
              components={{
                openai: (
                  <a
                    href="https://github.com/openai/skills"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
                  />
                ),
                anthropic: (
                  <a
                    href="https://github.com/anthropics/skills"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
                  />
                ),
                standard: (
                  <a
                    href="https://agentskills.io"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
                  />
                ),
              }}
            />
          </p>
        </div>

        {installedSkills.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">
              {t('skills.installed')}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {installedSkills.map((skill) => (
                <div
                  key={skill.id}
                  ref={setSkillCardRef(skill.id)}
                  className={cn(
                    'scroll-mt-20 rounded-lg transition-shadow duration-300',
                    highlightedSkillId === skill.id &&
                      'ring-2 ring-amber-400 ring-offset-2 ring-offset-background'
                  )}
                >
                  <SkillCard skill={skill} onSelect={openDetail} onInstall={install} />
                </div>
              ))}
            </div>
          </div>
        )}

        {recommendedSkills.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">
              {t('skills.recommended')}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {recommendedSkills.map((skill) => (
                <div
                  key={skill.id}
                  ref={setSkillCardRef(skill.id)}
                  className={cn(
                    'scroll-mt-20 rounded-lg transition-shadow duration-300',
                    highlightedSkillId === skill.id &&
                      'ring-2 ring-amber-400 ring-offset-2 ring-offset-background'
                  )}
                >
                  <SkillCard skill={skill} onSelect={openDetail} onInstall={install} />
                </div>
              ))}
            </div>
          </div>
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
