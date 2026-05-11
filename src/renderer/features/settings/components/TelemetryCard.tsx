import React from 'react';
import { useTranslation } from 'react-i18next';
import { PRODUCT_NAME } from '@shared/app-identity';
import { useTelemetryConsent } from '@renderer/lib/hooks/useTelemetryConsent';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Switch } from '@renderer/lib/ui/switch';
import { SettingRow } from './SettingRow';

const TelemetryCard: React.FC = () => {
  const { t } = useTranslation();
  const { prefEnabled, envDisabled, hasKeyAndHost, loading, setTelemetryEnabled } =
    useTelemetryConsent();

  return (
    <SettingRow
      title={t('settings.telemetry.title')}
      description={
        <div>
          <p>{t('settings.telemetry.description', { product: PRODUCT_NAME })}</p>
          <p>
            <span>{t('settings.telemetry.see')}</span>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="group inline-flex h-auto items-center gap-1 px-0 text-sm font-normal text-muted-foreground hover:text-foreground hover:no-underline focus-visible:outline-none focus-visible:ring-0"
              onClick={() => rpc.app.openExternal('https://lovstudio.ai/yoda/docs/telemetry')}
            >
              <span className="transition-colors group-hover:text-foreground">
                {t('settings.telemetry.info')}
              </span>
              <span className="text-sm text-muted-foreground transition-colors group-hover:text-foreground">
                ↗
              </span>
            </Button>
            <span>{t('settings.telemetry.forDetails')}</span>
          </p>
        </div>
      }
      control={
        <div className="flex flex-col items-end gap-1">
          <Switch
            checked={prefEnabled}
            onCheckedChange={async (checked) => {
              void import('../../../utils/telemetryClient').then(({ captureTelemetry }) => {
                captureTelemetry('setting_changed', { setting: 'telemetry' });
              });
              void setTelemetryEnabled(checked);
            }}
            disabled={loading || envDisabled}
            aria-label={t('settings.telemetry.ariaToggle')}
          />
          {!hasKeyAndHost && (
            <span className="text-[10px] text-muted-foreground">
              {t('settings.telemetry.inactive')}
            </span>
          )}
        </div>
      }
    />
  );
};

export default TelemetryCard;
