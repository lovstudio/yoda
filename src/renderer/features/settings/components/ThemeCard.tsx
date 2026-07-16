import {
  Download,
  FileJson,
  ImagePlus,
  Leaf,
  Monitor,
  Moon,
  Sparkles,
  Sprout,
  Sun,
  Sunset,
  Trash2,
  Upload,
} from 'lucide-react';
import React, { useCallback, useMemo, useRef, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { SystemThemes, Theme } from '@shared/app-settings';
import {
  createCustomThemeCollection,
  createDreamSkinTheme,
  CUSTOM_THEME_EXAMPLE,
  CUSTOM_THEME_EXAMPLE_FILE_NAME,
  DREAM_SKIN_BUILTIN_IMAGE,
  DREAM_SKIN_MAX_IMAGE_BYTES,
  DREAM_SKIN_SUPPORTED_IMAGE_TYPES,
  getCustomThemeId,
  parseCustomThemePackageText,
  toCustomThemeSelection,
  type CustomTheme,
} from '@shared/custom-theme';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { captureTelemetry } from '@renderer/utils/telemetryClient';
import { cn } from '@renderer/utils/utils';

// Two pairs and a standalone: neutral 白/黑, brand 浅绿/暗绿, fixed 暖.
const BUILT_IN_THEME_BUTTONS = [
  { value: 'ylight', Icon: Sun, label: 'yodaLight', aria: 'ariaLight' },
  { value: 'ydark', Icon: Moon, label: 'yodaDark', aria: 'ariaDark' },
  { value: 'ylight2', Icon: Sprout, label: 'yodaLightGreen', aria: 'ariaLightGreen' },
  { value: 'ygreen', Icon: Leaf, label: 'yodaDarkGreen', aria: 'ariaDarkGreen' },
  { value: 'ywarm', Icon: Sunset, label: 'yodaWarm', aria: 'ariaWarm' },
  { value: 'ydream', Icon: Sparkles, label: 'yodaDream', aria: 'ariaDream' },
  {
    value: 'ydream-night',
    Icon: Sparkles,
    label: 'yodaDreamNight',
    aria: 'ariaDreamNight',
  },
] as const;

const ThemeCard: React.FC = () => {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { value: customThemesValue, update, isSaving } = useAppSettingsKey('customThemes');
  const { value: systemThemesValue, update: updateSystemThemes } =
    useAppSettingsKey('systemThemes');
  const { toast } = useToast();
  const showConfirm = useShowModal('confirmActionModal');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const customThemes = useMemo(() => customThemesValue?.items ?? [], [customThemesValue?.items]);
  const selectedCustomThemeId = getCustomThemeId(theme);
  const systemThemes: SystemThemes = systemThemesValue ?? { light: 'ylight', dark: 'ydark' };

  // Any theme can fill either system slot — light/dark mode of a theme is a
  // preset, not a restriction. Defaults are 尤达白 / 尤达黑.
  const systemSlotOptions = [
    ...BUILT_IN_THEME_BUTTONS.map(({ value, label }) => ({
      value: value as SystemThemes['light'],
      label: t(`settings.theme.${label}`),
    })),
    ...customThemes.map((item) => ({
      value: toCustomThemeSelection(item.id),
      label: item.name,
    })),
  ];

  const handleSetTheme = useCallback(
    (next: Theme) => {
      if (theme !== next) {
        captureTelemetry('setting_changed', { setting: 'theme' });
      }
      setTheme(next);
    },
    [setTheme, theme]
  );

  const buttonBase =
    'flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border px-2 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:px-3';
  const activeClass = 'bg-background-2';
  const inactiveClass =
    'border-border/60 bg-background text-foreground-muted hover:bg-background-1';
  const customThemeButtonClass =
    'flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring';

  const saveImportedThemes = useCallback(
    (nextThemes: CustomTheme[]) => {
      const nextItems = [...customThemes];
      let updatedCount = 0;

      for (const nextTheme of nextThemes) {
        const duplicateIndex = nextItems.findIndex(
          (item) =>
            item.id === nextTheme.id ||
            item.name.trim().toLowerCase() === nextTheme.name.trim().toLowerCase()
        );
        if (duplicateIndex === -1) {
          nextItems.push(nextTheme);
        } else {
          nextItems[duplicateIndex] = nextTheme;
          updatedCount += 1;
        }
      }

      update({ items: nextItems });
      toast({
        title:
          nextThemes.length === 1
            ? t(updatedCount > 0 ? 'settings.theme.themeUpdated' : 'settings.theme.themeImported')
            : t('settings.theme.themeCollectionImported'),
        description:
          nextThemes.length === 1
            ? nextThemes[0]?.name
            : t('settings.theme.themeCollectionImportSummary', {
                count: nextThemes.length,
                updated: updatedCount,
              }),
      });
    },
    [customThemes, t, toast, update]
  );

  const finishImport = useCallback(
    (nextThemes: CustomTheme[]) => {
      const duplicateCount = nextThemes.filter((nextTheme) =>
        customThemes.some(
          (item) =>
            item.id === nextTheme.id ||
            item.name.trim().toLowerCase() === nextTheme.name.trim().toLowerCase()
        )
      ).length;
      if (duplicateCount === 0) {
        saveImportedThemes(nextThemes);
        return;
      }

      showConfirm({
        title: t('settings.theme.overwriteTitle'),
        description:
          nextThemes.length === 1
            ? t('settings.theme.overwriteDescription', { name: nextThemes[0]?.name })
            : t('settings.theme.overwriteCollectionDescription', { count: duplicateCount }),
        confirmLabel: t('settings.theme.overwriteConfirm'),
        variant: 'default',
        onSuccess: () => saveImportedThemes(nextThemes),
      });
    },
    [customThemes, saveImportedThemes, showConfirm, t]
  );

  const confirmWarnings = useCallback(
    (nextThemes: CustomTheme[], warningCount: number) => {
      showConfirm({
        title: t('settings.theme.warningTitle'),
        description: t('settings.theme.warningDescription', { count: warningCount }),
        confirmLabel: t('settings.theme.importAnyway'),
        variant: 'default',
        onSuccess: () => finishImport(nextThemes),
      });
    },
    [finishImport, showConfirm, t]
  );

  const handleImportFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      try {
        const result = parseCustomThemePackageText(await file.text());
        if (!result.ok) {
          toast({
            title: t('settings.theme.importFailed'),
            description: result.message,
            variant: 'destructive',
          });
          return;
        }

        const nextThemes = result.themes.map(({ theme: nextTheme }) => nextTheme);
        const warningCount = result.themes.reduce(
          (total, { warnings }) => total + warnings.length,
          0
        );
        if (warningCount > 0) {
          confirmWarnings(nextThemes, warningCount);
          return;
        }

        finishImport(nextThemes);
      } catch (error) {
        toast({
          title: t('settings.theme.importFailed'),
          description: error instanceof Error ? error.message : t('settings.theme.readFailed'),
          variant: 'destructive',
        });
      }
    },
    [confirmWarnings, finishImport, t, toast]
  );

  const handleCreateSkin = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      if (
        !DREAM_SKIN_SUPPORTED_IMAGE_TYPES.includes(
          file.type as (typeof DREAM_SKIN_SUPPORTED_IMAGE_TYPES)[number]
        )
      ) {
        toast({
          title: t('settings.theme.skinImportFailed'),
          description: t('settings.theme.skinUnsupportedType'),
          variant: 'destructive',
        });
        return;
      }
      if (file.size > DREAM_SKIN_MAX_IMAGE_BYTES) {
        toast({
          title: t('settings.theme.skinImportFailed'),
          description: t('settings.theme.skinTooLarge'),
          variant: 'destructive',
        });
        return;
      }

      try {
        const image = await readFileAsDataUrl(file);
        const baseName =
          file.name.replace(/\.[^.]+$/, '').trim() || t('settings.theme.untitledSkin');
        const id = `dream-${safeFileName(baseName).slice(0, 36)}-${Date.now().toString(36)}`;
        const nextTheme = createDreamSkinTheme({
          id,
          name: baseName,
          image,
          imageName: file.name,
        });
        saveImportedThemes([nextTheme]);
        handleSetTheme(toCustomThemeSelection(nextTheme.id));
      } catch (error) {
        toast({
          title: t('settings.theme.skinImportFailed'),
          description: error instanceof Error ? error.message : t('settings.theme.readFailed'),
          variant: 'destructive',
        });
      }
    },
    [handleSetTheme, saveImportedThemes, t, toast]
  );

  const handleDeleteTheme = useCallback(
    (item: CustomTheme) => {
      showConfirm({
        title: t('settings.theme.deleteTitle'),
        description: t('settings.theme.deleteDescription', { name: item.name }),
        confirmLabel: t('settings.theme.deleteConfirm'),
        onSuccess: () => {
          update({ items: customThemes.filter((themeItem) => themeItem.id !== item.id) });
          if (selectedCustomThemeId === item.id) {
            setTheme(null);
          }
          toast({ title: t('settings.theme.themeDeleted'), description: item.name });
        },
      });
    },
    [customThemes, selectedCustomThemeId, setTheme, showConfirm, t, toast, update]
  );

  const exportTheme = useCallback((item: CustomTheme) => {
    downloadJson(`${safeFileName(item.id)}.yoda-theme.json`, item);
  }, []);

  const revealSavedFile = useCallback(
    async (filePath: string) => {
      try {
        const result = await rpc.app.openIn({ app: 'finder', path: filePath, reveal: true });
        if (!result?.success) throw new Error(result?.error ?? t('common.unknownError'));
      } catch (error) {
        toast({
          title: t('settings.theme.revealSavedFileFailed'),
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        });
      }
    },
    [t, toast]
  );

  const exportExampleTheme = useCallback(async () => {
    try {
      const filePath = await saveJsonFile({
        title: t('settings.theme.saveExampleJsonTitle'),
        fileName: CUSTOM_THEME_EXAMPLE_FILE_NAME,
        data: CUSTOM_THEME_EXAMPLE,
      });
      if (!filePath) return;

      toast({
        title: t('settings.theme.themeJsonSaved'),
        description: filePath,
        action: {
          label: t('settings.theme.revealSavedFile'),
          onClick: () => void revealSavedFile(filePath),
        },
      });
    } catch (error) {
      if (isMissingSaveTextFileHandler(error)) {
        downloadJson(CUSTOM_THEME_EXAMPLE_FILE_NAME, CUSTOM_THEME_EXAMPLE);
        toast({
          title: t('settings.theme.themeJsonDownloadStarted'),
          description: t('settings.theme.restartForSaveReveal'),
        });
        return;
      }

      toast({
        title: t('settings.theme.saveJsonFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  }, [revealSavedFile, t, toast]);

  const exportAllThemes = useCallback(() => {
    if (customThemes.length === 0) return;
    downloadJson('yoda-custom-themes.json', createCustomThemeCollection(customThemes));
  }, [customThemes]);

  return (
    <div className="grid gap-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-medium text-foreground">{t('settings.theme.colorMode')}</div>
          <div className="text-foreground-muted">{t('settings.theme.chooseHowYodaLooks')}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => void handleImportFile(event)}
          />
          <input
            ref={imageInputRef}
            type="file"
            accept={DREAM_SKIN_SUPPORTED_IMAGE_TYPES.join(',')}
            className="hidden"
            onChange={(event) => void handleCreateSkin(event)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => imageInputRef.current?.click()}
            disabled={isSaving}
          >
            <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
            {t('settings.theme.createSkin')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void exportExampleTheme()}
          >
            <FileJson className="h-3.5 w-3.5" aria-hidden="true" />
            {t('settings.theme.exampleJson')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={isSaving}
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            {t('settings.theme.import')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={exportAllThemes}
            disabled={customThemes.length === 0}
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            {t('settings.theme.exportAll')}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2">
        <button
          type="button"
          onClick={() => handleSetTheme(null)}
          className={`${buttonBase} ${theme === null ? activeClass : inactiveClass}`}
          aria-pressed={theme === null}
          aria-label={t('settings.theme.ariaSystem')}
        >
          <Monitor className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="text-center">{t('settings.theme.system')}</span>
        </button>
        {BUILT_IN_THEME_BUTTONS.map(({ value, Icon, label, aria }) => (
          <button
            key={value}
            type="button"
            onClick={() => handleSetTheme(value)}
            className={`${buttonBase} ${theme === value ? activeClass : inactiveClass}`}
            aria-pressed={theme === value}
            aria-label={t(`settings.theme.${aria}`)}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="text-center">{t(`settings.theme.${label}`)}</span>
          </button>
        ))}
      </div>
      {theme === null && (
        <div className="grid grid-cols-1 gap-2 rounded-md border border-border/60 bg-background-1 px-3 py-2.5 @2xl:grid-cols-2">
          <SystemSlotSelect
            label={t('settings.theme.systemLight')}
            value={systemThemes.light}
            options={systemSlotOptions}
            onChange={(next) => updateSystemThemes({ ...systemThemes, light: next })}
          />
          <SystemSlotSelect
            label={t('settings.theme.systemDark')}
            value={systemThemes.dark}
            options={systemSlotOptions}
            onChange={(next) => updateSystemThemes({ ...systemThemes, dark: next })}
          />
        </div>
      )}
      <div className="mt-1 grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-foreground-muted">
            {t('settings.theme.customThemes')}
          </div>
          <div className="text-xs text-foreground-passive">
            {t('settings.theme.customThemeCount', { count: customThemes.length })}
          </div>
        </div>
        {customThemes.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/70 px-3 py-3 text-xs text-foreground-muted">
            {t('settings.theme.noCustomThemes')}
          </div>
        ) : (
          <div className="grid gap-1.5">
            {customThemes.map((item) => {
              const selection = toCustomThemeSelection(item.id);
              const isActive = selectedCustomThemeId === item.id;
              return (
                <div
                  key={item.id}
                  className={cn(
                    'grid grid-cols-[minmax(0,1fr)_auto] items-center overflow-hidden rounded-md border border-border/60 bg-background',
                    isActive && 'border-border-1 bg-background-2'
                  )}
                >
                  <button
                    type="button"
                    className={customThemeButtonClass}
                    aria-pressed={isActive}
                    onClick={() => handleSetTheme(selection)}
                  >
                    <ThemeSwatches theme={item} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-foreground">{item.name}</span>
                      <span className="flex items-center gap-2 text-xs text-foreground-muted">
                        <span>{item.id}</span>
                        <span className="rounded-sm border border-border/70 px-1 uppercase">
                          {item.mode}
                        </span>
                        {item.skin ? (
                          <span className="rounded-sm border border-border/70 px-1 uppercase">
                            {t('settings.theme.skinBadge')}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                  <div className="flex items-center gap-1 px-2">
                    <IconButton
                      label={t('settings.theme.exportTheme', { name: item.name })}
                      onClick={() => exportTheme(item)}
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      label={t('settings.theme.deleteTheme', { name: item.name })}
                      onClick={() => handleDeleteTheme(item)}
                      destructive
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </IconButton>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

function SystemSlotSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: SystemThemes['light'];
  options: Array<{ value: SystemThemes['light']; label: string }>;
  onChange: (next: SystemThemes['light']) => void;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <label className="flex min-w-0 items-center justify-between gap-2">
      <span className="shrink-0 text-xs text-foreground-muted">{label}</span>
      <div className="w-36 min-w-0">
        <Select
          value={value}
          onValueChange={(next) => {
            if (next) onChange(next as SystemThemes['light']);
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue>{() => selected?.label ?? value}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </label>
  );
}

function ThemeSwatches({ theme }: { theme: CustomTheme }) {
  if (theme.skin) {
    const backgroundImage =
      theme.skin.image === DREAM_SKIN_BUILTIN_IMAGE ? undefined : `url(${theme.skin.image})`;
    return (
      <span
        className="h-8 w-12 shrink-0 rounded-md border border-border/70 bg-background-3 bg-cover bg-center"
        style={backgroundImage ? { backgroundImage } : undefined}
      />
    );
  }

  const swatches = [
    theme.colors.background,
    theme.colors.background2,
    theme.colors.foreground,
    theme.colors.primaryButtonBackground,
    theme.colors.diffAdded,
    theme.colors.diffDeleted,
  ];

  return (
    <span className="grid h-8 w-12 shrink-0 grid-cols-3 overflow-hidden rounded-md border border-border/70">
      {swatches.map((color, index) => (
        <span
          key={`${theme.id}-${color}-${index}`}
          className="min-h-0 min-w-0"
          style={{ backgroundColor: color }}
        />
      ))}
    </span>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Failed to read image.'));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function IconButton({
  label,
  onClick,
  destructive = false,
  children,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            className={destructive ? 'text-foreground-muted hover:text-foreground-destructive' : ''}
            onClick={onClick}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function downloadJson(fileName: string, data: unknown): void {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function saveJsonFile({
  title,
  fileName,
  data,
}: {
  title: string;
  fileName: string;
  data: unknown;
}): Promise<string | null> {
  const result = await rpc.app.saveTextFileDialog({
    title,
    defaultPath: fileName,
    content: `${JSON.stringify(data, null, 2)}\n`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (!result.success) {
    throw new Error(result.error);
  }
  if (result.canceled) return null;
  return result.filePath;
}

function isMissingSaveTextFileHandler(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("No handler registered for 'app.saveTextFileDialog'");
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').toLowerCase();
}

export default ThemeCard;
