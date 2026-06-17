import { Eye, Pencil } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FileActionsDropdown } from '@renderer/features/tasks/components/file-actions';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { useSessionNoteSync } from '@renderer/features/tasks/use-session-note-sync';
import { rpc } from '@renderer/lib/ipc';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';

interface MarkdownEditorRendererProps {
  filePath: string;
}

/**
 * Renders a markdown file as a formatted preview.
 * A floating "Edit source" button in the top-right corner toggles to Monaco source view.
 */
export const MarkdownEditorRenderer = observer(function MarkdownEditorRenderer({
  filePath,
}: MarkdownEditorRendererProps) {
  const { t } = useTranslation();
  const { projectId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const { workspaceId } = provisioned;
  const { editorView, tabManager } = provisioned.taskView;
  const syncNote = useSessionNoteSync();
  const sourcePath = `${provisioned.path.replace(/\/+$/, '')}/${filePath}`;
  const bufferUri = buildMonacoModelPath(editorView.modelRootPath, filePath);
  // Reading bufferVersions creates a MobX tracking dependency so this observer()
  // component re-renders whenever the buffer content changes or is first populated.

  const _version = modelRegistry.bufferVersions.get(bufferUri);
  const content = modelRegistry.getValue(bufferUri) ?? '';
  const fileDir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';

  const resolveImage = useCallback(
    async (src: string): Promise<string | null> => {
      const imagePath = fileDir ? `${fileDir}/${src}` : src;
      const result = await rpc.fs.readImage(projectId, workspaceId, imagePath);
      return result.success ? (result.data?.dataUrl ?? null) : null;
    },
    [projectId, workspaceId, fileDir]
  );

  return (
    <div className="relative h-full overflow-y-auto bg-background-secondary-1">
      <ToggleGroup
        value={['markdown']}
        onValueChange={(value) => {
          if (value.includes('markdown-source')) {
            tabManager.updateRenderer(filePath, () => ({ kind: 'markdown-source' }));
          }
        }}
        size="sm"
        className="sticky top-3 z-10 float-right mr-3"
      >
        <ToggleGroupItem value="markdown" aria-label={t('editor.preview')}>
          <Eye className="h-3.5 w-3.5" />
        </ToggleGroupItem>
        <ToggleGroupItem value="markdown-source" aria-label={t('editor.editSource')}>
          <Pencil className="h-3.5 w-3.5" />
        </ToggleGroupItem>
        <FileActionsDropdown
          sourcePath={sourcePath}
          className="flex h-full w-auto items-center justify-center rounded-none border-l border-border px-2"
        />
      </ToggleGroup>
      <MarkdownRenderer
        content={content}
        variant="full"
        className="mx-auto w-full max-w-3xl px-8 py-8"
        resolveImage={resolveImage}
        onAddNote={syncNote}
      />
    </div>
  );
});
