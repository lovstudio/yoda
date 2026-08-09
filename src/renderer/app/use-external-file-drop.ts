import { useCallback, useRef, useState, type DragEvent } from 'react';
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
      // Composer and other nested drop targets keep their own behavior.
      if (event.defaultPrevented || !hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setIsDragOver(false);

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
    [t, toast]
  );

  return { isDragOver, onDragEnter, onDragLeave, onDragOver, onDrop };
}
