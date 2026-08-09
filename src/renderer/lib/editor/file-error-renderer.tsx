import { Check, Copy, FileX2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { copyTextToClipboard, useToast } from '@renderer/lib/hooks/use-toast';
import { Button } from '@renderer/lib/ui/button';

interface FileErrorRendererProps {
  file: { path: string; error?: string };
}

/** Shown when a file could not be loaded (e.g. file not found or read error). */
export function FileErrorRenderer({ file }: FileErrorRendererProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const fileName = file.path.split('/').pop() ?? file.path;

  const copyDiagnostics = async () => {
    try {
      await copyTextToClipboard(
        [`文件: ${file.path}`, file.error ? `错误: ${file.error}` : undefined]
          .filter(Boolean)
          .join('\n')
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch (error: unknown) {
      toast.error(t('common.copyFailed'), { description: String(error) });
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground bg-background-secondary-1">
      <FileX2 className="h-10 w-10 opacity-30" />
      <div className="text-center">
        <p className="text-sm font-medium">{fileName}</p>
        <p className="mt-1 max-w-md break-all px-4 text-xs opacity-70">
          {file.error ?? t('editor.fileNotFound')}
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={() => void copyDiagnostics()}>
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? t('common.copied') : t('common.copy')}
      </Button>
    </div>
  );
}
