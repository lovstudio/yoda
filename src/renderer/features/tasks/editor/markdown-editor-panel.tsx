import { Eye, Pencil } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { FileActionsDropdown } from '@renderer/features/tasks/components/file-actions';
import { LeasedMonacoEditor } from '@renderer/features/tasks/editor/leased-monaco-editor';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { MarkdownEditorRenderer } from '@renderer/lib/editor/markdown-renderer';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';

/**
 * Handles both markdown preview and markdown source editing.
 * When renderer.kind is 'markdown': shows the rendered preview.
 * When renderer.kind is 'markdown-source': shows a self-contained Monaco editor
 * that owns its own pool lease — separate from the shared persistent Monaco used
 * for plain text/code files.
 */
export const MarkdownEditorPanel = observer(function MarkdownEditorPanel() {
  const { taskView } = useProvisionedTask();
  const activeTab = taskView.tabManager.activeFileEntry;

  if (!activeTab) return null;

  if (activeTab.renderer.kind === 'markdown-source') {
    return (
      <LeasedMonacoEditor
        key={activeTab.tabId}
        filePath={activeTab.path}
        overlay={<MarkdownSourceToggleOverlay filePath={activeTab.path} />}
      />
    );
  }

  return <MarkdownEditorRenderer filePath={activeTab.path} />;
});

// ---------------------------------------------------------------------------
// Toggle overlay: switches between markdown preview and source
// ---------------------------------------------------------------------------

interface MarkdownSourceToggleOverlayProps {
  filePath: string;
}

export function MarkdownSourceToggleOverlay({ filePath }: MarkdownSourceToggleOverlayProps) {
  const { t } = useTranslation();
  const provisioned = useProvisionedTask();
  const { tabManager } = provisioned.taskView;
  const sourcePath = `${provisioned.path.replace(/\/+$/, '')}/${filePath}`;

  return (
    <ToggleGroup
      value={['markdown-source']}
      onValueChange={(value) => {
        if (value.includes('markdown')) {
          tabManager.updateRenderer(filePath, () => ({ kind: 'markdown' }));
        }
      }}
      size="sm"
      className="absolute right-3 top-3 z-10"
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
  );
}
