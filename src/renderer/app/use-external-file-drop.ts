import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';

function hasFiles(event: DragEvent<HTMLElement>): boolean {
  return event.dataTransfer.types.includes('Files');
}

export function useExternalFileDrop() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isDragOver, setIsDragOver] = useState(false);
  const dragDepth = useRef(0);

  const clearDragState = useCallback(() => {
    dragDepth.current = 0;
    setIsDragOver(false);
  }, []);

  // The overlay must never outlive the drag. Nested drop targets (terminal,
  // composer) preventDefault the drop and keep the file for themselves, and a
  // drag can also end inside a webview or be cancelled — none of those balance
  // the dragenter that raised the overlay. Watch the window in capture phase so
  // the end of a drag clears it no matter who consumed the event, and let Esc
  // dismiss it as a last resort.
  useEffect(() => {
    if (!isDragOver) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearDragState();
    };
    window.addEventListener('drop', clearDragState, true);
    window.addEventListener('dragend', clearDragState, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('drop', clearDragState, true);
      window.removeEventListener('dragend', clearDragState, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [isDragOver, clearDragState]);

  const onDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    if (event.defaultPrevented || !hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setIsDragOver(true);
  }, []);

  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (event.defaultPrevented || !hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (!hasFiles(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragOver(false);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      // The drag is over either way — drop the overlay before deciding whether
      // this drop is ours.
      clearDragState();
      // Composer and other nested drop targets keep their own behavior.
      if (event.defaultPrevented || !hasFiles(event)) return;
      event.preventDefault();

      const files = Array.from(event.dataTransfer.files);
      const paths = files.flatMap((file) => {
        const filePath = window.electronAPI.getPathForFile(file).trim();
        return filePath ? [filePath] : [];
      });

      if (paths.length === 0) {
        toast({
          title: t('externalFileDrop.failedTitle'),
          description: t('externalFileDrop.noPath'),
          variant: 'destructive',
        });
        return;
      }

      void (async () => {
        const failures: Array<{ path: string; error: string }> = [];
        for (const filePath of paths) {
          try {
            const result = await rpc.app.openExternalFile(filePath);
            if (!result.success) failures.push({ path: filePath, error: result.error });
          } catch (error: unknown) {
            failures.push({
              path: filePath,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        if (failures.length > 0) {
          toast({
            title: t('externalFileDrop.failedTitle'),
            description: t('externalFileDrop.failedDescription', { count: failures.length }),
            variant: 'destructive',
            debugInfo: { paths, failures },
          });
        }
      })();
    },
    [clearDragState, t, toast]
  );

  return { isDragOver, onDragEnter, onDragLeave, onDragOver, onDrop };
}
