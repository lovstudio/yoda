import { Stethoscope } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { cn } from '@renderer/utils/utils';
import { RUNTIME_BAR_ACTION_CLASS, RUNTIME_BAR_ACTION_LABEL_CLASS } from '../bar-chrome';

/** Environment diagnostics — the first stop when a runtime refuses to start. */
export const RuntimeBarDoctorItem = observer(function RuntimeBarDoctorItem() {
  const { t } = useTranslation();
  const showDoctorModal = useShowModal('doctorModal');
  return (
    <button
      type="button"
      title={t('workspaceRuntime.doctor')}
      aria-label={t('workspaceRuntime.doctor')}
      onClick={() => showDoctorModal({})}
      className={cn(RUNTIME_BAR_ACTION_CLASS, 'text-foreground-passive')}
    >
      <Stethoscope aria-hidden className="size-3.5" />
      <span className={RUNTIME_BAR_ACTION_LABEL_CLASS}>{t('workspaceRuntime.doctor')}</span>
    </button>
  );
});
