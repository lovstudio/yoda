import { useQuery } from '@tanstack/react-query';
import { Cloud, ExternalLink, FileText, FolderOpen } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getProjectSettingsStore } from '@renderer/features/projects/stores/project-selectors';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { Spinner } from '@renderer/lib/ui/spinner';
import { cn } from '@renderer/utils/utils';

type DocsMode = 'local' | 'cloud';

/**
 * Project Docs page. Surfaces the project's documentation from two optional
 * sources configured in `.yoda.json` (see ShareableProjectSettings.docs):
 * a repo-relative markdown directory (`localPath`) and a deployed docs site
 * (`cloudUrl`). Shows whichever are set; lets the user switch when both exist.
 */
export const DocsPanel = observer(function DocsPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const settingsStore = getProjectSettingsStore(projectId);

  useEffect(() => {
    void settingsStore?.pageData.load();
  }, [settingsStore]);

  const docs = settingsStore?.settings?.docs;
  const localPath = docs?.localPath?.trim() || undefined;
  const cloudUrl = docs?.cloudUrl?.trim() || undefined;

  const [preferred, setPreferred] = useState<DocsMode>('local');
  const mode: DocsMode = localPath && cloudUrl ? preferred : localPath ? 'local' : 'cloud';

  if (!localPath && !cloudUrl) {
    return (
      <EmptyState
        label={t('projects.docs.emptyTitle')}
        description={t('projects.docs.emptyDescription')}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('project', { projectId, view: 'settings' })}
          >
            {t('projects.docs.configure')}
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        {localPath && cloudUrl ? (
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5">
            <SegmentButton
              active={mode === 'local'}
              icon={<FolderOpen className="size-3.5" />}
              label={t('projects.docs.sourceLocal')}
              onClick={() => setPreferred('local')}
            />
            <SegmentButton
              active={mode === 'cloud'}
              icon={<Cloud className="size-3.5" />}
              label={t('projects.docs.sourceCloud')}
              onClick={() => setPreferred('cloud')}
            />
          </div>
        ) : (
          <span className="flex items-center gap-1.5 text-xs font-medium text-foreground-muted">
            {mode === 'local' ? (
              <FolderOpen className="size-3.5" />
            ) : (
              <Cloud className="size-3.5" />
            )}
            {mode === 'local' ? t('projects.docs.sourceLocal') : t('projects.docs.sourceCloud')}
          </span>
        )}
        <div className="flex-1" />
        {mode === 'cloud' && cloudUrl ? (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-foreground-muted"
            onClick={() => void rpc.app.openExternal(cloudUrl)}
          >
            <ExternalLink className="size-3.5" />
            {t('projects.docs.openExternal')}
          </Button>
        ) : null}
      </header>
      <div className="min-h-0 flex-1">
        {mode === 'local' && localPath ? (
          <LocalDocs projectId={projectId} localPath={localPath} />
        ) : cloudUrl ? (
          // Constant src keyed by URL — only remounts when the configured URL changes.
          <webview key={cloudUrl} src={cloudUrl} className="h-full w-full" />
        ) : null}
      </div>
    </div>
  );
});

function SegmentButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors',
        active ? 'bg-background-2 text-foreground' : 'text-foreground-muted hover:text-foreground'
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** Strips the configured docs root prefix for a friendly tree label. */
function displayName(filePath: string, root: string): string {
  const normalizedRoot = root.replace(/^\.?\/+/, '').replace(/\/+$/, '');
  const rel =
    normalizedRoot && filePath.startsWith(`${normalizedRoot}/`)
      ? filePath.slice(normalizedRoot.length + 1)
      : filePath;
  return rel;
}

const LocalDocs = observer(function LocalDocs({
  projectId,
  localPath,
}: {
  projectId: string;
  localPath: string;
}) {
  const { t } = useTranslation();

  const filesQuery = useQuery({
    queryKey: ['project-docs-files', projectId, localPath],
    queryFn: async () => {
      const result = await rpc.fs.listPathCompletions(projectId, localPath, {
        recursive: true,
        includeHidden: false,
        maxEntries: 1000,
      });
      if (!result.success) throw new Error('Failed to list docs directory');
      return result.data.entries
        .filter((entry) => entry.type === 'file' && /\.mdx?$/i.test(entry.path))
        .map((entry) => entry.path)
        .sort((a, b) => a.localeCompare(b));
    },
  });

  const files = useMemo(() => filesQuery.data ?? [], [filesQuery.data]);
  const [selected, setSelected] = useState<string | null>(null);

  // Default to a README/index at the shallowest depth, else the first file.
  const defaultFile = useMemo(() => {
    if (files.length === 0) return null;
    const preferred = files.find((f) => /(^|\/)(readme|index)\.mdx?$/i.test(f));
    return preferred ?? files[0];
  }, [files]);

  const active = selected && files.includes(selected) ? selected : defaultFile;

  const contentQuery = useQuery({
    queryKey: ['project-docs-content', projectId, active],
    enabled: !!active,
    queryFn: async () => {
      const result = await rpc.fs.readProjectFile(projectId, active!, 2 * 1024 * 1024);
      if (!result.success) throw new Error('Failed to read doc');
      return result.data.content;
    },
  });

  if (filesQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (filesQuery.isError) {
    return (
      <EmptyState
        label={t('projects.docs.loadError')}
        description={t('projects.docs.loadErrorHint', { path: localPath })}
      />
    );
  }

  if (files.length === 0) {
    return (
      <EmptyState
        label={t('projects.docs.emptyDir')}
        description={t('projects.docs.emptyDirHint', { path: localPath })}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <nav className="w-56 shrink-0 overflow-y-auto border-r border-border p-2">
        {files.map((file) => (
          <button
            key={file}
            type="button"
            title={file}
            onClick={() => setSelected(file)}
            className={cn(
              'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs',
              file === active
                ? 'bg-background-2 text-foreground'
                : 'text-foreground-muted hover:bg-background-2 hover:text-foreground'
            )}
          >
            <FileText className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{displayName(file, localPath)}</span>
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {contentQuery.isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : contentQuery.isError ? (
          <EmptyState label={t('projects.docs.loadError')} />
        ) : (
          <div className="mx-auto w-full max-w-3xl px-6 py-6">
            <MarkdownRenderer content={contentQuery.data ?? ''} />
          </div>
        )}
      </div>
    </div>
  );
});
