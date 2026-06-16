import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { Input } from '@renderer/lib/ui/input';
import { Switch } from '@renderer/lib/ui/switch';
import { SettingRow } from './SettingRow';

const MIN_ROWS = 1;
const MAX_ROWS = 20;

const clampRows = (value: number) =>
  Number.isFinite(value) ? Math.min(MAX_ROWS, Math.max(MIN_ROWS, Math.round(value))) : 3;

const InterfaceSettingsCard: React.FC = () => {
  const { t } = useTranslation();
  const { value, update, isLoading: loading, isSaving: saving } = useAppSettingsKey('interface');

  const dockSessionHistory = value?.dockSessionHistory ?? false;
  const dockSessionHistoryRows = clampRows(value?.dockSessionHistoryRows ?? 3);

  const [rowsDraft, setRowsDraft] = useState(String(dockSessionHistoryRows));
  const skipCommitRef = useRef(false);

  useEffect(() => {
    setRowsDraft(String(dockSessionHistoryRows));
  }, [dockSessionHistoryRows]);

  const applyRows = (next: string) => {
    const normalized = clampRows(Number(next));
    setRowsDraft(String(normalized));
    if (normalized !== dockSessionHistoryRows) update({ dockSessionHistoryRows: normalized });
  };

  return (
    <div className="flex flex-col gap-4">
      <SettingRow
        title={t('settings.interface.dockSessionHistory')}
        description={t('settings.interface.dockSessionHistoryDescription')}
        control={
          <Switch
            checked={dockSessionHistory}
            disabled={loading || saving}
            onCheckedChange={(next) => update({ dockSessionHistory: next })}
          />
        }
      />
      <SettingRow
        title={t('settings.interface.dockSessionHistoryRows')}
        description={t('settings.interface.dockSessionHistoryRowsDescription')}
        control={
          <div className="flex w-[183px] items-center gap-2">
            <Input
              type="number"
              min={MIN_ROWS}
              max={MAX_ROWS}
              step={1}
              value={rowsDraft}
              disabled={loading || saving || !dockSessionHistory}
              aria-label={t('settings.interface.dockSessionHistoryRows')}
              className="h-9 text-right"
              onChange={(e) => setRowsDraft(e.target.value)}
              onBlur={() => {
                if (skipCommitRef.current) {
                  skipCommitRef.current = false;
                  return;
                }
                applyRows(rowsDraft);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                  return;
                }
                if (e.key === 'Escape') {
                  skipCommitRef.current = true;
                  setRowsDraft(String(dockSessionHistoryRows));
                  e.currentTarget.blur();
                }
              }}
            />
            <span className="shrink-0 text-xs text-foreground-passive">
              {t('settings.interface.rowsUnit')}
            </span>
          </div>
        }
      />
    </div>
  );
};

export default InterfaceSettingsCard;
