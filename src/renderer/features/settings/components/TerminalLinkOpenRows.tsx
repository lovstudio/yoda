import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getAppById } from '@shared/openInApps';
import {
  DEFAULT_TERMINAL_LINK_OPEN,
  parseFileHandlerExtensions,
  TERMINAL_LINK_OPEN_CHANGED_EVENT,
  type TerminalFileHandlerRule,
  type TerminalLinkFileHandler,
  type TerminalLinkOpenSettings,
  type TerminalLinkUrlHandler,
} from '@shared/terminal-settings';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useOpenInApps } from '@renderer/lib/hooks/useOpenInApps';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { cn } from '@renderer/utils/utils';
import { SettingDisclosure } from './SettingDisclosure';
import { SettingRow } from './SettingRow';

type FileHandlerOption = {
  id: TerminalLinkFileHandler;
  label: string;
  icon?: string;
  invertInDark?: boolean;
};

/**
 * Terminal link handling: which handler receives a clicked file path, which one
 * receives a URL, and per-format overrides on top of the file default.
 *
 * The handler is all the user picks. Where an in-app target lands stays the
 * surface's call — a terminal in the main column opens into the task sidebar,
 * a session pinned into the sidebar opens into the main area — so no setting
 * can ask a pinned session to replace itself.
 */
export function TerminalLinkOpenRows() {
  const { t } = useTranslation();
  const { value: terminal, update, isLoading, isSaving } = useAppSettingsKey('terminal');
  const { installedApps, icons, labels } = useOpenInApps();
  const disabled = isLoading || isSaving;
  const linkOpen = terminal?.linkOpen ?? DEFAULT_TERMINAL_LINK_OPEN;

  const apply = useCallback(
    (patch: Partial<TerminalLinkOpenSettings>) => {
      const next: TerminalLinkOpenSettings = { ...linkOpen, ...patch };
      update({ linkOpen: next });
      // Live terminals hold their own copy; this is how they learn about the change.
      window.dispatchEvent(new CustomEvent(TERMINAL_LINK_OPEN_CHANGED_EVENT, { detail: next }));
    },
    [linkOpen, update]
  );

  const fileHandlerOptions = useMemo<FileHandlerOption[]>(
    () => [
      { id: 'yoda', label: t('settings.terminal.linkOpen.yoda') },
      { id: 'system', label: t('settings.terminal.linkOpen.system') },
      ...installedApps.map((app) => ({
        id: app.id,
        label: labels[app.id] ?? app.label,
        icon: icons[app.id],
        invertInDark: getAppById(app.id)?.invertInDark === true,
      })),
    ],
    [icons, installedApps, labels, t]
  );

  const setRules = (fileRules: TerminalFileHandlerRule[]) => apply({ fileRules });

  return (
    <>
      <SettingRow
        title={t('settings.terminal.linkOpen.fileTitle')}
        description={t('settings.terminal.linkOpen.fileDescription')}
        control={
          <FileHandlerSelect
            value={linkOpen.file}
            options={fileHandlerOptions}
            disabled={disabled}
            ariaLabel={t('settings.terminal.linkOpen.fileTitle')}
            onChange={(file) => apply({ file })}
          />
        }
      />
      <SettingRow
        title={t('settings.terminal.linkOpen.urlTitle')}
        description={t('settings.terminal.linkOpen.urlDescription')}
        control={
          <Select
            value={linkOpen.url}
            disabled={disabled}
            onValueChange={(url) => apply({ url: url as TerminalLinkUrlHandler })}
          >
            <SelectTrigger
              className="h-8 w-[183px]"
              aria-label={t('settings.terminal.linkOpen.urlTitle')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="yoda">{t('settings.terminal.linkOpen.browserYoda')}</SelectItem>
              <SelectItem value="system">
                {t('settings.terminal.linkOpen.browserSystem')}
              </SelectItem>
            </SelectContent>
          </Select>
        }
      />
      <SettingDisclosure
        title={t('settings.terminal.linkOpen.rulesTitle')}
        description={t('settings.terminal.linkOpen.rulesDescription')}
      >
        <div className="flex flex-col gap-2">
          {linkOpen.fileRules.map((rule, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                className="h-7 min-w-0 flex-1 font-mono text-xs"
                defaultValue={rule.extensions.join(', ')}
                placeholder={t('settings.terminal.linkOpen.extensionsPlaceholder')}
                disabled={disabled}
                onBlur={(event) => {
                  const extensions = parseFileHandlerExtensions(event.target.value);
                  if (extensions.join(',') === rule.extensions.join(',')) return;
                  setRules(
                    linkOpen.fileRules.map((item, i) =>
                      i === index ? { ...item, extensions } : item
                    )
                  );
                }}
              />
              <FileHandlerSelect
                value={rule.handler}
                options={fileHandlerOptions}
                disabled={disabled}
                ariaLabel={t('settings.terminal.linkOpen.rulesTitle')}
                onChange={(handler) =>
                  setRules(
                    linkOpen.fileRules.map((item, i) => (i === index ? { ...item, handler } : item))
                  )
                }
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-foreground-passive hover:text-foreground"
                aria-label={t('settings.terminal.linkOpen.removeRule')}
                disabled={disabled}
                onClick={() => setRules(linkOpen.fileRules.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
          <div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              disabled={disabled}
              onClick={() =>
                setRules([...linkOpen.fileRules, { extensions: [], handler: 'system' }])
              }
            >
              <Plus className="size-3.5" />
              {t('settings.terminal.linkOpen.addRule')}
            </Button>
          </div>
        </div>
      </SettingDisclosure>
    </>
  );
}

function FileHandlerSelect({
  value,
  options,
  disabled,
  ariaLabel,
  onChange,
}: {
  value: TerminalLinkFileHandler;
  options: FileHandlerOption[];
  disabled: boolean;
  ariaLabel: string;
  onChange: (next: TerminalLinkFileHandler) => void;
}) {
  // An app can be uninstalled after being chosen; keep the stored value
  // selectable so opening the dropdown does not silently rewrite it.
  const hasValue = options.some((option) => option.id === value);

  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => onChange(next as TerminalLinkFileHandler)}
    >
      <SelectTrigger className="h-8 w-[183px]" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option, index) => (
          <React.Fragment key={option.id}>
            {index === 2 ? <SelectSeparator /> : null}
            <SelectItem value={option.id}>
              <span className="flex min-w-0 items-center gap-2">
                {option.icon ? (
                  <img
                    src={option.icon}
                    alt=""
                    className={cn('size-4 rounded', option.invertInDark && 'dark:invert')}
                  />
                ) : option.id === 'system' ? (
                  <ExternalLink className="size-4" />
                ) : null}
                <span className="truncate">{option.label}</span>
              </span>
            </SelectItem>
          </React.Fragment>
        ))}
        {hasValue ? null : <SelectItem value={value}>{value}</SelectItem>}
      </SelectContent>
    </Select>
  );
}
