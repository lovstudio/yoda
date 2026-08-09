import { observer } from 'mobx-react-lite';
import type { FileTabStore } from '@renderer/features/tasks/tabs/file-tab-store';
import { useRequireProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { BinaryRenderer } from '@renderer/lib/editor/binary-renderer';
import { FileErrorRenderer } from '@renderer/lib/editor/file-error-renderer';
import { ImageRenderer } from '@renderer/lib/editor/image-renderer';
import { PdfRenderer } from '@renderer/lib/editor/pdf-renderer';
import { SvgRenderer } from '@renderer/lib/editor/svg-renderer';
import { TooLargeRenderer } from '@renderer/lib/editor/too-large-renderer';

/**
 * Renders file types that do not use Monaco: image, svg preview, pdf, binary, too-large, file-error.
 * Shown inside Activity(other-file) in main-panel.tsx.
 */
export const EditorMainPanel = observer(function EditorMainPanel() {
  const { taskView } = useRequireProvisionedTask();
  const activeTab = taskView.tabManager.activeFileEntry;

  if (!activeTab) return null;

  return (
    <div className="h-full overflow-hidden">
      <OtherFileRenderer file={activeTab} />
    </div>
  );
});

interface OtherFileRendererProps {
  file: FileTabStore;
}

export function OtherFileRenderer({ file }: OtherFileRendererProps) {
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
      return <FileErrorRenderer file={{ path: file.path, error: file.renderer.error }} />;
    default:
      return null;
  }
}
