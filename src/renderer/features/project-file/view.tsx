import { Save } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileTabStore } from '@renderer/features/tasks/tabs/file-tab-store';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { BinaryRenderer } from '@renderer/lib/editor/binary-renderer';
import { FileErrorRenderer } from '@renderer/lib/editor/file-error-renderer';
import { ImageRenderer } from '@renderer/lib/editor/image-renderer';
import { PdfRenderer } from '@renderer/lib/editor/pdf-renderer';
import { SvgRenderer } from '@renderer/lib/editor/svg-renderer';
import { TooLargeRenderer } from '@renderer/lib/editor/too-large-renderer';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { Spinner } from '@renderer/lib/ui/spinner';
import { cn } from '@renderer/utils/utils';
import { ProjectFileEditor } from './project-file-editor';
import { getProjectFileSession, type ProjectFileSession } from './project-file-session';

type ProjectFileViewParams = {
  /** Absent for project-less (agent-home) files — see project-file-session. */
  projectId?: string;
  filePath: string;
};

function ProjectFileWrapView({ children }: PropsWithChildren<ProjectFileViewParams>) {
  return <>{children}</>;
}

function ProjectFileTitlebar() {
  return <Titlebar />;
}

const MONACO_RENDERER_KINDS = new Set(['text', 'markdown', 'markdown-source', 'svg-source']);

const ProjectFileMainPanel = observer(function ProjectFileMainPanel() {
  const { t } = useTranslation();
  const {
    params: { projectId, filePath },
  } = useParams('file');

  const [session, setSession] = useState<ProjectFileSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    setSession(null);
    setError(null);
    getProjectFileSession(projectId ?? null, filePath)
      .then((next) => {
        if (!cancelled) setSession(next);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, filePath]);

  if (!filePath) return null;

  if (error) {
    return <EmptyState label={t('common.error')} description={error} />;
  }

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="sm" className="text-foreground-muted" />
      </div>
    );
  }

  return <ProjectFileContent key={`${projectId ?? ''}::${filePath}`} session={session} />;
});

const ProjectFileContent = observer(function ProjectFileContent({
  session,
}: {
  session: ProjectFileSession;
}) {
  const { t } = useTranslation();
  const bufferUri = buildMonacoModelPath(session.lifecycle.modelRootPath, session.filePath);
  const isDirty = modelRegistry.isDirty(bufferUri);
  const isMonaco = MONACO_RENDERER_KINDS.has(session.fileTab.renderer.kind);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-1.5">
        <code className="min-w-0 truncate font-mono text-xs text-foreground-muted">
          {session.filePath}
        </code>
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full bg-primary transition-opacity',
            isDirty ? 'opacity-100' : 'opacity-0'
          )}
        />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {isMonaco ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={!isDirty || session.lifecycle.isSaving}
              onClick={() => void session.lifecycle.saveFile(session.filePath)}
            >
              <Save className="size-3.5" />
              {t('common.save')}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {isMonaco ? (
          <ProjectFileEditor session={session} />
        ) : (
          <NonTextRenderer file={session.fileTab} />
        )}
      </div>
    </div>
  );
});

function NonTextRenderer({ file }: { file: FileTabStore }) {
  switch (file.renderer.kind) {
    case 'svg':
      return <SvgRenderer filePath={file.path} />;
    case 'image':
      return <ImageRenderer file={file} />;
    case 'pdf':
      return <PdfRenderer file={file} />;
    case 'too-large':
      return <TooLargeRenderer file={file} />;
    case 'binary':
      return <BinaryRenderer file={file} />;
    case 'file-error':
      return <FileErrorRenderer file={file} />;
    default:
      return null;
  }
}

export const projectFileView = {
  WrapView: ProjectFileWrapView,
  TitlebarSlot: ProjectFileTitlebar,
  MainPanel: ProjectFileMainPanel,
};
