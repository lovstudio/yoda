import { Eye, Pencil } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';

interface SvgRendererProps {
  filePath: string;
}

interface SvgPreviewProps {
  filePath: string;
  modelRootPath: string;
  onShowSource: () => void;
}

/**
 * Context-free SVG preview, shared by task editors and standalone project-file
 * tabs. Its caller owns the model root and source-view transition.
 */
export const SvgPreview = observer(function SvgPreview({
  filePath,
  modelRootPath,
  onShowSource,
}: SvgPreviewProps) {
  const { t } = useTranslation();
  const bufferUri = buildMonacoModelPath(modelRootPath, filePath);

  // Touch bufferVersions so this observer re-renders when the buffer is first
  // populated — otherwise the preview can stick on an empty src.
  void modelRegistry.bufferVersions.get(bufferUri);
  const content = modelRegistry.getValue(bufferUri) ?? '';
  const svgUrl = useMemo(
    () => (content ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}` : ''),
    [content]
  );
  const fileName = filePath.split('/').pop() ?? filePath;

  return (
    <div className="relative flex h-full items-center justify-center overflow-auto p-4">
      {svgUrl ? (
        <img src={svgUrl} alt={fileName} className="max-h-full max-w-full object-contain" />
      ) : (
        <div className="text-xs text-foreground-passive">{t('common.loading')}</div>
      )}
      <ToggleGroup
        value={['svg']}
        onValueChange={(value) => {
          if (value.includes('svg-source')) {
            onShowSource();
          }
        }}
        size="sm"
        className="absolute right-3 top-3 z-10"
      >
        <ToggleGroupItem value="svg" aria-label={t('editor.viewRendered')}>
          <Eye className="h-3.5 w-3.5" />
        </ToggleGroupItem>
        <ToggleGroupItem value="svg-source" aria-label={t('editor.editSource')}>
          <Pencil className="h-3.5 w-3.5" />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
});

/** Renders an SVG from the active task editor's model registry. */
export const SvgRenderer = observer(function SvgRenderer({ filePath }: SvgRendererProps) {
  const { taskView } = useProvisionedTask();
  const { editorView, tabManager } = taskView;

  return (
    <SvgPreview
      filePath={filePath}
      modelRootPath={editorView.modelRootPath}
      onShowSource={() => tabManager.updateRenderer(filePath, () => ({ kind: 'svg-source' }))}
    />
  );
});
