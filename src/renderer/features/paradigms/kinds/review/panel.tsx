import { useTranslation } from 'react-i18next';
import { REVIEW_MAX_ROUNDS } from '@shared/review-protocol';

/** States how many implement/review rounds the loop may run. */
export function ReviewParadigmPanel() {
  const { t } = useTranslation();
  return (
    <div className="px-1 text-xs text-foreground-muted">
      {t('home.reviewRoundLimit', { count: REVIEW_MAX_ROUNDS })}
    </div>
  );
}
