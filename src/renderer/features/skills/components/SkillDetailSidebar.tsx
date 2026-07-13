import { GitCompare, PanelRightOpen, Search } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CatalogSkill } from '@shared/skills/types';
import { useOpenViewTab } from '@renderer/lib/layout/navigation-provider';
import { appState } from '@renderer/lib/stores/app-state';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { Input } from '@renderer/lib/ui/input';
import { cn } from '@renderer/utils/utils';
import SkillIconRenderer from './SkillIconRenderer';

function sortSkills(skills: CatalogSkill[]): CatalogSkill[] {
  return [...skills].sort((left, right) => {
    if (left.installed !== right.installed) return left.installed ? -1 : 1;
    return left.displayName.localeCompare(right.displayName);
  });
}

const SkillDetailSidebar: React.FC<{
  activeSkillId: string;
  catalogSection: 'installed' | 'recommended';
  skills: CatalogSkill[];
}> = ({ activeSkillId, catalogSection, skills }) => {
  const { t } = useTranslation();
  const { openViewTab } = useOpenViewTab();
  const [query, setQuery] = useState('');
  const activeItemRef = useRef<HTMLButtonElement>(null);
  const [emphasizedSkillId, setEmphasizedSkillId] = useState<string | null>(null);

  const visibleSkills = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const sorted = sortSkills(
      skills.filter((skill) =>
        catalogSection === 'installed' ? skill.installed : !skill.installed
      )
    );
    if (!normalizedQuery) return sorted;
    return sorted.filter(
      (skill) =>
        skill.displayName.toLocaleLowerCase().includes(normalizedQuery) ||
        skill.id.toLocaleLowerCase().includes(normalizedQuery) ||
        skill.description.toLocaleLowerCase().includes(normalizedQuery)
    );
  }, [catalogSection, query, skills]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const node = activeItemRef.current;
      if (!node || node.getClientRects().length === 0) return;
      node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setEmphasizedSkillId(activeSkillId);
    });
    const timeout = window.setTimeout(() => {
      setEmphasizedSkillId((current) => (current === activeSkillId ? null : current));
    }, 2400);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [activeSkillId, visibleSkills]);

  return (
    <aside className="hidden h-full w-60 shrink-0 flex-col border-r border-border bg-background-secondary @2xl:flex">
      <div className="shrink-0 border-b border-border p-2.5">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-foreground-muted" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('skills.searchPlaceholder')}
            aria-label={t('skills.searchPlaceholder')}
            className="h-8 bg-background pl-8 text-xs"
          />
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto p-1.5" aria-label={t('skills.title')}>
        {visibleSkills.map((skill) => {
          const active = skill.id === activeSkillId;
          return (
            <ContextMenu key={skill.id}>
              <ContextMenuTrigger
                render={
                  <button
                    ref={active ? activeItemRef : undefined}
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() =>
                      openViewTab('skill', {
                        skillId: skill.id,
                        displayName: skill.displayName,
                        catalogSection,
                      })
                    }
                    className={cn(
                      'relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                      active
                        ? 'bg-background-1 text-foreground'
                        : 'text-foreground-muted hover:bg-background-2 hover:text-foreground',
                      emphasizedSkillId === skill.id &&
                        'ring-2 ring-amber-400 ring-offset-1 ring-offset-background-secondary'
                    )}
                  >
                    {active && (
                      <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-foreground" />
                    )}
                    <SkillIconRenderer skill={skill} size="xs" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">
                        {skill.displayName}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-foreground-muted">
                        {skill.installed ? t('skills.installed') : t('skills.recommended')}
                      </span>
                    </span>
                    {skill.disabled && (
                      <span className="size-1.5 shrink-0 rounded-full bg-foreground-muted" />
                    )}
                  </button>
                }
              />
              <ContextMenuContent className="w-48">
                <ContextMenuItem
                  disabled={active}
                  onClick={() =>
                    openViewTab('skillCompare', {
                      baseSkillId: activeSkillId,
                      targetSkillId: skill.id,
                      baseDisplayName:
                        skills.find((candidate) => candidate.id === activeSkillId)?.displayName ??
                        activeSkillId,
                      targetDisplayName: skill.displayName,
                    })
                  }
                >
                  <GitCompare />
                  {t('skills.compare.action')}
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={active}
                  onClick={() =>
                    appState.sidePane.pinView('skill', {
                      skillId: skill.id,
                      displayName: skill.displayName,
                      catalogSection,
                    })
                  }
                >
                  <PanelRightOpen />
                  {t('skills.detail.openInSidePane')}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
        {visibleSkills.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-foreground-muted">
            {t('skills.noMatches')}
          </p>
        )}
      </nav>
    </aside>
  );
};

export default SkillDetailSidebar;
