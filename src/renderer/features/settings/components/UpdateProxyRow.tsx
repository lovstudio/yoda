import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { Input } from '@renderer/lib/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { SettingRow } from './SettingRow';

/**
 * Lets users route the auto-updater through a proxy. The updater runs in its own
 * Electron session and does not inherit a shell/CLI proxy, so behind ClashX-style
 * proxies the GitHub download fails unless this is set. `auto` follows the OS
 * proxy; `custom` uses an explicit URL (e.g. http://127.0.0.1:7890).
 */
export function UpdateProxyRow(): React.JSX.Element {
  const { t } = useTranslation();
  const { value, update, isLoading } = useAppSettingsKey('updates');
  const mode = value?.proxyMode ?? 'auto';

  // Local draft so typing doesn't write to settings on every keystroke; the
  // value is committed on blur (or Enter, which blurs the input).
  const [draftUrl, setDraftUrl] = React.useState('');
  React.useEffect(() => {
    setDraftUrl(value?.proxyUrl ?? '');
  }, [value?.proxyUrl]);

  const commitUrl = () => {
    const next = draftUrl.trim();
    if (next !== (value?.proxyUrl ?? '')) {
      update({ proxyUrl: next });
    }
  };

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <SettingRow
        title={t('settings.update.proxy.title')}
        description={t('settings.update.proxy.description')}
        control={
          <Select
            value={mode}
            disabled={isLoading}
            onValueChange={(next) => update({ proxyMode: next as 'auto' | 'custom' })}
          >
            <SelectTrigger className="w-auto shrink-0 gap-2 [&>span]:line-clamp-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="min-w-max">
              <SelectItem value="auto">{t('settings.update.proxy.auto')}</SelectItem>
              <SelectItem value="custom">{t('settings.update.proxy.custom')}</SelectItem>
            </SelectContent>
          </Select>
        }
      />
      {mode === 'custom' && (
        <Input
          value={draftUrl}
          disabled={isLoading}
          placeholder="http://127.0.0.1:7890"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(e) => setDraftUrl(e.target.value)}
          onBlur={commitUrl}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      )}
    </div>
  );
}
