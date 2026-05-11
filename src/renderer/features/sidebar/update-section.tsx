import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { MicroLabel } from '@renderer/lib/ui/label';

export const UpdateSection = observer(function UpdateSection() {
  const { t } = useTranslation();
  const update = appState.update;
  const { navigate } = useNavigate();

  if (update.hasUpdate) {
    return (
      <Button
        variant="outline"
        size="xs"
        onClick={() =>
          navigate('settings', {
            tab: 'general',
          })
        }
      >
        {t('sidebar.update')}
      </Button>
    );
  }

  return (
    <MicroLabel className="inline-flex h-6 items-center lowercase text-foreground-passive">
      v{update.currentVersion}
    </MicroLabel>
  );
});
