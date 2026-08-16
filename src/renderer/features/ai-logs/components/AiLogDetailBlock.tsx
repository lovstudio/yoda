import { Code2, Copy, ListTree, Maximize2, Minimize2 } from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HeaderActionButton, HeaderActionToolbar } from '@renderer/lib/components/header-actions';
import { copyTextToClipboard, useToast } from '@renderer/lib/hooks/use-toast';
import { cn } from '@renderer/utils/utils';
import { buildCompactCommand } from '../log-debug-info';

/**
 * One labelled evidence block (prompt, answer, command, error) with copy,
 * raw/compact command toggle and expand-to-full-height controls.
 */
export const AiLogDetailBlock: React.FC<{
  label: string;
  value: string;
  mono?: boolean;
  destructive?: boolean;
  compactCommand?: boolean;
  className?: string;
}> = ({ label, value, mono, destructive, compactCommand, className }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [fullyExpanded, setFullyExpanded] = useState(false);
  const [showRawCommand, setShowRawCommand] = useState(false);
  const compactValue = compactCommand
    ? buildCompactCommand(value, (count) => t('aiLogs.commandValueCollapsed', { count }))
    : undefined;
  const displayedValue = compactValue && !showRawCommand ? compactValue : value;
  const copyLabel = t('aiLogs.copyDetail', { label });
  const resizeLabel = t(fullyExpanded ? 'aiLogs.collapseDetail' : 'aiLogs.expandDetail', {
    label,
  });

  const copyValue = async (): Promise<void> => {
    try {
      await copyTextToClipboard(value);
      toast.success(t('aiLogs.detailCopied', { label }));
    } catch {
      toast.error(t('common.copyFailed'));
    }
  };

  return (
    <section
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-background',
        destructive && 'border-destructive/25 bg-destructive/5',
        className
      )}
    >
      <div className="flex min-h-8 items-center justify-between gap-2 border-b border-border px-2.5 py-1">
        <span
          className={cn(
            'min-w-0 truncate text-xs font-medium text-muted-foreground',
            destructive && 'text-destructive'
          )}
        >
          {label}
        </span>
        <HeaderActionToolbar label={t('aiLogs.detailActions', { label })}>
          <HeaderActionButton label={copyLabel} onClick={() => void copyValue()}>
            <Copy className="size-3" />
          </HeaderActionButton>
          {compactValue && (
            <HeaderActionButton
              label={t(showRawCommand ? 'aiLogs.showCompactCommand' : 'aiLogs.showRawCommand')}
              aria-pressed={showRawCommand}
              onClick={() => setShowRawCommand((value) => !value)}
            >
              {showRawCommand ? <ListTree className="size-3" /> : <Code2 className="size-3" />}
            </HeaderActionButton>
          )}
          <HeaderActionButton
            label={resizeLabel}
            aria-expanded={fullyExpanded}
            onClick={() => setFullyExpanded((value) => !value)}
          >
            {fullyExpanded ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
          </HeaderActionButton>
        </HeaderActionToolbar>
      </div>
      <pre
        tabIndex={0}
        aria-label={label}
        className={cn(
          'overflow-auto px-2.5 py-2 text-xs leading-5 whitespace-pre-wrap break-words [scrollbar-gutter:stable]',
          fullyExpanded ? 'max-h-[min(60vh,40rem)]' : 'max-h-32',
          mono ? 'font-mono' : 'font-sans',
          destructive && 'text-destructive'
        )}
      >
        {displayedValue}
      </pre>
    </section>
  );
};
