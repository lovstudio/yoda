import { Import } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LegacyImportSource, LegacyPortPreviewSource } from '@shared/legacy-port';
import { sourceLabel } from './import-format';

export type SingleSourceImport = {
  source: LegacyImportSource;
  preview: LegacyPortPreviewSource;
};

export type ImportHeaderProps = {
  isLoading: boolean;
  singleSource?: SingleSourceImport | null;
};

export function ImportHeader({ isLoading, singleSource = null }: ImportHeaderProps) {
  const { t } = useTranslation();

  const formatCountKey = (count: number, kind: 'project' | 'task') =>
    t(`onboarding.import.${kind}Count${count === 1 ? 'Singular' : 'Plural'}`, { count });

  const title = singleSource
    ? t('onboarding.import.headerSingleTitle', { source: sourceLabel(singleSource.source) })
    : t('onboarding.import.headerMultiTitle');
  const description = singleSource
    ? t('onboarding.import.headerSingleDescription', {
        projectsCount: formatCountKey(singleSource.preview.projects, 'project'),
        tasksCount: formatCountKey(singleSource.preview.tasks, 'task'),
      })
    : t('onboarding.import.headerMultiDescription');

  return (
    <div className="flex shrink-0 flex-col items-center justify-center gap-4">
      <div className="flex flex-col items-center justify-center gap-5">
        <Import className="h-10 w-10" absoluteStrokeWidth strokeWidth={1.5} />
        <div className="flex flex-col items-center justify-center gap-2">
          <h1 className="text-xl text-center">{title}</h1>
          {isLoading ? (
            <p className="text-md text-foreground-muted text-center">
              {t('onboarding.import.scanning')}
            </p>
          ) : (
            <p className="text-md text-foreground-muted text-center">{description}</p>
          )}
        </div>
      </div>
    </div>
  );
}
