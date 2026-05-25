import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface ActionCardProps {
  selectedCount: number;
  selectionActions: ReactNode;
  generalActions: ReactNode;
}

export function ActionCard({ selectedCount, selectionActions, generalActions }: ActionCardProps) {
  const { t } = useTranslation();
  const hasSelection = selectedCount > 0;
  return (
    <div className="shrink-0 mx-2 flex items-center justify-between rounded-lg border border-border bg-background-1 pl-2.5 pr-1.5 py-1.5">
      <span className="text-xs text-foreground-muted truncate min-w-0">
        {hasSelection
          ? t('changes.filesSelected', { count: selectedCount })
          : t('changes.allFiles')}
      </span>
      <div className="flex items-center gap-1.5">
        {hasSelection ? selectionActions : generalActions}
      </div>
    </div>
  );
}
