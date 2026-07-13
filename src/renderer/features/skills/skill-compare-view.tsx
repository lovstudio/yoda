import { useQuery } from '@tanstack/react-query';
import { GitCompare, Loader2 } from 'lucide-react';
import type * as monaco from 'monaco-editor';
import React, { useEffect, useMemo, useRef, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import type { CatalogSkill } from '@shared/skills/types';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { rpc } from '@renderer/lib/ipc';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { diffEditorPool, type DiffPoolEntry } from '@renderer/lib/monaco/monaco-diff-pool';
import { Badge } from '@renderer/lib/ui/badge';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { diffLines } from './line-diff';

type SkillCompareViewParams = {
  baseSkillId: string;
  targetSkillId: string;
  baseDisplayName?: string;
  targetDisplayName?: string;
};

export function SkillCompareTitlebar() {
  return <Titlebar />;
}

export function SkillCompareWrapView({ children }: PropsWithChildren<SkillCompareViewParams>) {
  return <>{children}</>;
}

async function loadSkill(skillId: string): Promise<CatalogSkill> {
  const result = await rpc.skills.getDetail({ skillId });
  if (result.success && result.data) return result.data;
  throw new Error(result.error ?? 'Failed to load skill detail');
}

export function SkillCompareMainPanel() {
  const { t } = useTranslation();
  const {
    params: { baseSkillId, targetSkillId, baseDisplayName, targetDisplayName },
  } = useParams('skillCompare');
  const base = useQuery({
    queryKey: ['skills', 'detail', baseSkillId],
    queryFn: () => loadSkill(baseSkillId),
    enabled: Boolean(baseSkillId),
  });
  const target = useQuery({
    queryKey: ['skills', 'detail', targetSkillId],
    queryFn: () => loadSkill(targetSkillId),
    enabled: Boolean(targetSkillId),
  });

  if (base.isPending || target.isPending) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-foreground-muted" />
      </div>
    );
  }
  if (!base.data || !target.data) {
    return (
      <EmptyState
        label={t('skills.compare.loadFailed')}
        description={t('skills.compare.loadFailedHint')}
      />
    );
  }

  const original = base.data.skillMdContent ?? '';
  const modified = target.data.skillMdContent ?? '';
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <SkillCompareHeader
        baseName={baseDisplayName ?? base.data.displayName}
        targetName={targetDisplayName ?? target.data.displayName}
        original={original}
        modified={modified}
      />
      <div className="min-h-0 flex-1">
        <SkillTextDiff original={original} modified={modified} />
      </div>
    </div>
  );
}

function SkillCompareHeader({
  baseName,
  targetName,
  original,
  modified,
}: {
  baseName: string;
  targetName: string;
  original: string;
  modified: string;
}) {
  const { t } = useTranslation();
  const stats = useMemo(() => {
    const lines = diffLines(original, modified);
    return {
      added: lines.filter((line) => line.kind === 'added').length,
      removed: lines.filter((line) => line.kind === 'removed').length,
    };
  }, [modified, original]);
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
      <GitCompare className="size-4 text-foreground-muted" />
      <span className="min-w-0 truncate text-xs font-medium">{baseName}</span>
      <span className="text-xs text-foreground-muted">→</span>
      <span className="min-w-0 truncate text-xs font-medium">{targetName}</span>
      <div className="ml-auto flex items-center gap-1.5">
        <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400">
          +{stats.added} {t('skills.compare.lines')}
        </Badge>
        <Badge variant="outline" className="text-red-600 dark:text-red-400">
          -{stats.removed} {t('skills.compare.lines')}
        </Badge>
      </div>
    </div>
  );
}

function SkillTextDiff({ original, modified }: { original: string; modified: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let entry: DiffPoolEntry | null = null;
    let originalModel: monaco.editor.ITextModel | null = null;
    let modifiedModel: monaco.editor.ITextModel | null = null;
    let cancelled = false;

    void diffEditorPool.lease().then(async (leased) => {
      if (cancelled || !mountRef.current) {
        diffEditorPool.release(leased);
        return;
      }
      entry = leased;
      mountRef.current.appendChild(leased.container);
      const monacoApi = await diffEditorPool.whenReady();
      if (cancelled) return;
      originalModel = monacoApi.editor.createModel(original, 'markdown');
      modifiedModel = monacoApi.editor.createModel(modified, 'markdown');
      leased.editor.setModel({ original: originalModel, modified: modifiedModel });
      leased.editor.layout();
    });

    return () => {
      cancelled = true;
      if (entry) diffEditorPool.release(entry);
      else {
        originalModel?.dispose();
        modifiedModel?.dispose();
      }
    };
  }, [modified, original]);
  return <div ref={mountRef} className="h-full min-h-0 w-full" />;
}

export const skillCompareView = {
  WrapView: SkillCompareWrapView,
  TitlebarSlot: SkillCompareTitlebar,
  MainPanel: SkillCompareMainPanel,
};
