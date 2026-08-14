import { useTranslation } from 'react-i18next';

/** Explains where the scaffolded project lands, below the build seat. */
export function AppBuildParadigmPanel() {
  const { t } = useTranslation();
  return (
    <p className="px-1 text-xs leading-relaxed text-foreground-muted">{t('home.buildAgentHint')}</p>
  );
}
