import { useQuery } from '@tanstack/react-query';
import { FileText, GitCompare, Loader2, Minus, Plus } from 'lucide-react';
import type * as monaco from 'monaco-editor';
import React, { useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import type { CatalogSkill, SkillFileSnapshot } from '@shared/skills/types';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { rpc } from '@renderer/lib/ipc';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { diffEditorPool, type DiffPoolEntry } from '@renderer/lib/monaco/monaco-diff-pool';
import { Badge } from '@renderer/lib/ui/badge';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { cn } from '@renderer/utils/utils';
import { diffLines } from './line-diff';

type SkillCompareViewParams = {
  /** Historical field names; both values are opaque stable skill keys. */
  baseSkillId: string;
  targetSkillId: string;
  baseDisplayName?: string;
  targetDisplayName?: string;
};

type SkillBundle = { skill: CatalogSkill; files: SkillFileSnapshot[] };
type FileStatus = 'added' | 'deleted' | 'modified' | 'unchanged';
type FileComparison = {
  path: string;
  status: FileStatus;
  original?: SkillFileSnapshot;
  modified?: SkillFileSnapshot;
  binary: boolean;
  tooLarge: boolean;
};

export function SkillCompareTitlebar() {
  return <Titlebar />;
}

export function SkillCompareWrapView({ children }: PropsWithChildren<SkillCompareViewParams>) {
  return <>{children}</>;
}

async function loadSkillBundle(skillKey: string): Promise<SkillBundle> {
  const [detail, files] = await Promise.all([
    rpc.skills.getDetail({ skillKey }),
    rpc.skills.getFiles({ skillKey }),
  ]);
  if (!detail.success || !detail.data) {
    throw new Error(detail.error ?? 'Failed to load skill detail');
  }
  if (!files.success || !files.data) {
    throw new Error(files.error ?? 'Failed to load skill files');
  }
  return { skill: detail.data, files: files.data };
}

function compareFiles(base: SkillFileSnapshot[], target: SkillFileSnapshot[]): FileComparison[] {
  const baseByPath = new Map(base.map((file) => [file.path, file]));
  const targetByPath = new Map(target.map((file) => [file.path, file]));
  const paths = [...new Set([...baseByPath.keys(), ...targetByPath.keys()])].sort((a, b) =>
    a.localeCompare(b)
  );
  return paths.map((filePath) => {
    const original = baseByPath.get(filePath);
    const modified = targetByPath.get(filePath);
    const status: FileStatus = !original
      ? 'added'
      : !modified
        ? 'deleted'
        : original.hash === modified.hash
          ? 'unchanged'
          : 'modified';
    return {
      path: filePath,
      status,
      original,
      modified,
      binary: Boolean(original?.binary || modified?.binary),
      tooLarge: Boolean(original?.tooLarge || modified?.tooLarge),
    };
  });
}

export function SkillCompareMainPanel() {
  const { t } = useTranslation();
  const {
    params: { baseSkillId, targetSkillId, baseDisplayName, targetDisplayName },
  } = useParams('skillCompare');
  const base = useQuery({
    queryKey: ['skills', 'bundle', baseSkillId],
    queryFn: () => loadSkillBundle(baseSkillId),
    enabled: Boolean(baseSkillId),
  });
  const target = useQuery({
    queryKey: ['skills', 'bundle', targetSkillId],
    queryFn: () => loadSkillBundle(targetSkillId),
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

  return (
    <SkillDirectoryDiff
      key={`${base.data.skill.key}:${target.data.skill.key}`}
      base={base.data}
      target={target.data}
      baseName={baseDisplayName ?? base.data.skill.displayName}
      targetName={targetDisplayName ?? target.data.skill.displayName}
    />
  );
}

function SkillDirectoryDiff({
  base,
  target,
  baseName,
  targetName,
}: {
  base: SkillBundle;
  target: SkillBundle;
  baseName: string;
  targetName: string;
}) {
  const comparisons = useMemo(
    () => compareFiles(base.files, target.files),
    [base.files, target.files]
  );
  const initialPath =
    comparisons.find((file) => file.path === 'SKILL.md' && file.status !== 'unchanged')?.path ??
    comparisons.find((file) => file.status !== 'unchanged')?.path ??
    comparisons[0]?.path ??
    '';
  const [selectedPath, setSelectedPath] = useState(initialPath);
  const selected = comparisons.find((file) => file.path === selectedPath) ?? comparisons[0];
  const totals = useMemo(() => aggregateStats(comparisons), [comparisons]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <SkillCompareHeader
        baseName={baseName}
        targetName={targetName}
        added={totals.added}
        removed={totals.removed}
        changedFiles={totals.changedFiles}
      />
      <div className="flex min-h-0 flex-1">
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-border bg-background-secondary p-1.5">
          {comparisons.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              selected={file.path === selected?.path}
              onSelect={() => setSelectedPath(file.path)}
            />
          ))}
        </aside>
        <main className="min-w-0 flex-1">
          {selected ? (
            <SelectedFileDiff file={selected} />
          ) : (
            <EmptyState label={baseName} description={targetName} />
          )}
        </main>
      </div>
    </div>
  );
}

function aggregateStats(files: FileComparison[]): {
  added: number;
  removed: number;
  changedFiles: number;
} {
  let added = 0;
  let removed = 0;
  let changedFiles = 0;
  for (const file of files) {
    if (file.status === 'unchanged') continue;
    changedFiles += 1;
    if (file.binary || file.tooLarge) continue;
    const stats = textDiffStats(file.original?.content ?? '', file.modified?.content ?? '');
    added += stats.added;
    removed += stats.removed;
  }
  return { added, removed, changedFiles };
}

function textDiffStats(original: string, modified: string): { added: number; removed: number } {
  const originalLines = original ? original.split('\n') : [];
  const modifiedLines = modified ? modified.split('\n') : [];
  if (originalLines.length * modifiedLines.length > 4_000_000) {
    return myersLineStats(originalLines, modifiedLines);
  }
  const lines = diffLines(original, modified);
  return {
    added: lines.filter((line) => line.kind === 'added').length,
    removed: lines.filter((line) => line.kind === 'removed').length,
  };
}

/** Exact insert/delete count without the quadratic-memory LCS table used by the preview diff. */
function myersLineStats(
  original: string[],
  modified: string[]
): { added: number; removed: number } {
  const originalLength = original.length;
  const modifiedLength = modified.length;
  const maxDistance = originalLength + modifiedLength;
  // Avoid pathological quadratic work for generated or vendored files. The
  // editor still renders the real diff; the header falls back to a conservative
  // full-file change count.
  if (maxDistance > 5_000) return { added: modifiedLength, removed: originalLength };
  let frontier = new Map<number, number>([[1, 0]]);
  for (let distance = 0; distance <= maxDistance; distance += 1) {
    const nextFrontier = new Map<number, number>();
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      let x =
        diagonal === -distance ||
        (diagonal !== distance &&
          (frontier.get(diagonal - 1) ?? -1) < (frontier.get(diagonal + 1) ?? -1))
          ? (frontier.get(diagonal + 1) ?? 0)
          : (frontier.get(diagonal - 1) ?? 0) + 1;
      let y = x - diagonal;
      while (x < originalLength && y < modifiedLength && original[x] === modified[y]) {
        x += 1;
        y += 1;
      }
      nextFrontier.set(diagonal, x);
      if (x >= originalLength && y >= modifiedLength) {
        return {
          added: (distance + modifiedLength - originalLength) / 2,
          removed: (distance + originalLength - modifiedLength) / 2,
        };
      }
    }
    frontier = nextFrontier;
  }
  return { added: modifiedLength, removed: originalLength };
}

function SkillCompareHeader({
  baseName,
  targetName,
  added,
  removed,
  changedFiles,
}: {
  baseName: string;
  targetName: string;
  added: number;
  removed: number;
  changedFiles: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
      <GitCompare className="size-4 text-foreground-muted" />
      <span className="min-w-0 truncate text-xs font-medium">{baseName}</span>
      <span className="text-xs text-foreground-muted">→</span>
      <span className="min-w-0 truncate text-xs font-medium">{targetName}</span>
      <Badge variant="secondary" className="ml-auto">
        {t('skills.compare.changedFiles', { count: changedFiles })}
      </Badge>
      <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400">
        +{added} {t('skills.compare.lines')}
      </Badge>
      <Badge variant="outline" className="text-red-600 dark:text-red-400">
        -{removed} {t('skills.compare.lines')}
      </Badge>
    </div>
  );
}

function FileRow({
  file,
  selected,
  onSelect,
}: {
  file: FileComparison;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const marker =
    file.status === 'added' ? (
      <Plus className="size-3 text-emerald-600" />
    ) : file.status === 'deleted' ? (
      <Minus className="size-3 text-red-600" />
    ) : (
      <span
        className={cn(
          'size-1.5 rounded-full',
          file.status === 'modified' ? 'bg-amber-500' : 'bg-foreground-muted/30'
        )}
      />
    );
  return (
    <button
      type="button"
      onClick={onSelect}
      title={`${file.path} · ${t(`skills.compare.status.${file.status}`)}`}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
        selected
          ? 'bg-background-1 text-foreground'
          : 'text-foreground-muted hover:bg-background-2',
        file.status === 'unchanged' && !selected && 'opacity-60'
      )}
    >
      <span className="grid size-3 shrink-0 place-items-center">{marker}</span>
      <FileText className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{file.path}</span>
    </button>
  );
}

function SelectedFileDiff({ file }: { file: FileComparison }) {
  const { t } = useTranslation();
  if (file.tooLarge) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-foreground-muted">
        <FileText className="size-6" />
        <p className="text-xs">{t('skills.compare.tooLarge')}</p>
        <p className="font-mono text-[10px]">{file.path}</p>
      </div>
    );
  }
  if (file.binary) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-foreground-muted">
        <FileText className="size-6" />
        <p className="text-xs">{t('skills.compare.binary')}</p>
        <p className="font-mono text-[10px]">{file.path}</p>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-3 py-1.5 font-mono text-[11px] text-foreground-muted">
        {file.path}
      </div>
      <div className="min-h-0 flex-1">
        <SkillTextDiff
          original={file.original?.content ?? ''}
          modified={file.modified?.content ?? ''}
          language={languageForPath(file.path)}
        />
      </div>
    </div>
  );
}

function languageForPath(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLocaleLowerCase();
  const languages: Record<string, string> = {
    bash: 'shell',
    css: 'css',
    html: 'html',
    js: 'javascript',
    json: 'json',
    jsx: 'javascript',
    md: 'markdown',
    mjs: 'javascript',
    py: 'python',
    sh: 'shell',
    ts: 'typescript',
    tsx: 'typescript',
    yaml: 'yaml',
    yml: 'yaml',
  };
  return languages[extension ?? ''] ?? 'plaintext';
}

function SkillTextDiff({
  original,
  modified,
  language,
}: {
  original: string;
  modified: string;
  language: string;
}) {
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
      originalModel = monacoApi.editor.createModel(original, language);
      modifiedModel = monacoApi.editor.createModel(modified, language);
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
  }, [language, modified, original]);
  return <div ref={mountRef} className="h-full min-h-0 w-full" />;
}

export const skillCompareView = {
  WrapView: SkillCompareWrapView,
  TitlebarSlot: SkillCompareTitlebar,
  MainPanel: SkillCompareMainPanel,
};
