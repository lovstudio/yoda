import { Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { copyText } from '@renderer/lib/clipboard';
import { cn } from '@renderer/utils/utils';

/**
 * Inline form-level error text with a copy affordance. Failures surfaced to the
 * user are usually the only trace of a main-process error, so every inline
 * error should be copyable together with whatever context helps debug it.
 */
export function InlineError({
  message,
  debugInfo,
  className,
}: {
  message: string;
  /** Extra context copied alongside the message — ids, paths, request params. */
  debugInfo?: Record<string, string | number | boolean | null | undefined>;
  className?: string;
}) {
  const { t } = useTranslation();

  const copyPayload = () => {
    const lines = [message];
    for (const [key, value] of Object.entries(debugInfo ?? {})) {
      if (value === undefined || value === null || value === '') continue;
      lines.push(`${key}: ${value}`);
    }
    return lines.join('\n');
  };

  return (
    <div className={cn('mt-1 flex items-start gap-1.5 text-xs text-destructive', className)}>
      <span className="min-w-0 flex-1 break-words">{message}</span>
      <button
        type="button"
        className="shrink-0 rounded p-0.5 text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
        aria-label={t('common.copyError')}
        title={t('common.copyError')}
        onClick={() =>
          void copyText(copyPayload(), t, {
            success: t('common.copied'),
            failure: t('common.copyFailed'),
          })
        }
      >
        <Copy className="size-3" />
      </button>
    </div>
  );
}
