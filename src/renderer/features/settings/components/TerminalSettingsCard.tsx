import { Check, ChevronDown } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MAX_TERMINAL_SCROLLBACK_LINES,
  MIN_TERMINAL_SCROLLBACK_LINES,
  normalizeTerminalScrollbackLines,
} from '@shared/terminal-settings';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Switch } from '@renderer/lib/ui/switch';
import { SettingRow } from './SettingRow';

type FontOption = {
  id: string;
  label: string;
  fontValue: string;
};

const POPULAR_FONTS = [
  'Menlo',
  'SF Mono',
  'JetBrains Mono',
  'Fira Code',
  'Cascadia Code',
  'Iosevka',
  'Source Code Pro',
  'MesloLGS NF',
];

const toOptionId = (font: string) =>
  `font-${font
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')}`;

const dedupeAndSort = (fonts: string[]) =>
  Array.from(new Set(fonts.map((font) => font.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );

const TerminalSettingsCard: React.FC = () => {
  const { t } = useTranslation();
  const {
    value: terminal,
    update,
    isLoading: loading,
    isSaving: saving,
  } = useAppSettingsKey('terminal');
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [search, setSearch] = useState<string>('');
  const [installedFonts, setInstalledFonts] = useState<string[] | null>(null);
  const [loadingFonts, setLoadingFonts] = useState<boolean>(false);

  const fontFamily = terminal?.fontFamily ?? '';
  const autoCopyOnSelection = terminal?.autoCopyOnSelection ?? true;
  const scrollbackLines = normalizeTerminalScrollbackLines(terminal?.scrollbackLines);
  const [scrollbackDraft, setScrollbackDraft] = useState<string>(String(scrollbackLines));
  const skipScrollbackCommitRef = useRef(false);

  const popularOptions = useMemo<FontOption[]>(() => {
    return [
      { id: 'popular-default', label: 'Default (Menlo)', fontValue: '' },
      ...POPULAR_FONTS.map((font) => ({
        id: `popular-${toOptionId(font)}`,
        label: font,
        fontValue: font,
      })),
    ];
  }, []);

  const installedOptions = useMemo<FontOption[]>(() => {
    const sourceFonts = dedupeAndSort(installedFonts ?? []);
    return sourceFonts
      .filter(
        (font) =>
          !POPULAR_FONTS.some((popular) => popular.toLowerCase() === font.toLowerCase()) &&
          font.toLowerCase() !== 'menlo'
      )
      .map((font) => ({
        id: `installed-${toOptionId(font)}`,
        label: font,
        fontValue: font,
      }));
  }, [installedFonts]);

  const allOptions = useMemo<FontOption[]>(() => {
    const byValue = new Map<string, FontOption>();
    for (const option of [...popularOptions, ...installedOptions]) {
      byValue.set(option.fontValue.toLowerCase(), option);
    }
    return Array.from(byValue.values());
  }, [installedOptions, popularOptions]);

  const findPreset = useCallback(
    (font: string) => {
      const normalized = font.trim().toLowerCase();
      return allOptions.find((option) => option.fontValue.toLowerCase() === normalized) ?? null;
    },
    [allOptions]
  );

  const loadInstalledFonts = useCallback(async () => {
    if (loadingFonts || installedFonts !== null) return;
    setLoadingFonts(true);
    try {
      const result = await rpc.app.listInstalledFonts();
      if (result?.success && Array.isArray(result.fonts) && result.fonts.length) {
        setInstalledFonts(dedupeAndSort(result.fonts));
      } else {
        setInstalledFonts([]);
      }
    } catch {
      setInstalledFonts([]);
    } finally {
      setLoadingFonts(false);
    }
  }, [installedFonts, loadingFonts]);

  useEffect(() => {
    if (pickerOpen) {
      void loadInstalledFonts();
    }
  }, [loadInstalledFonts, pickerOpen]);

  useEffect(() => {
    setScrollbackDraft(String(scrollbackLines));
  }, [scrollbackLines]);

  const applyFont = useCallback(
    (next: string) => {
      const normalized = next.trim();
      update({ fontFamily: normalized });
      window.dispatchEvent(
        new CustomEvent('terminal-font-changed', { detail: { fontFamily: normalized } })
      );
    },
    [update]
  );

  const toggleAutoCopy = useCallback(
    (next: boolean) => {
      update({ autoCopyOnSelection: next });
      window.dispatchEvent(
        new CustomEvent('terminal-auto-copy-changed', { detail: { autoCopyOnSelection: next } })
      );
    },
    [update]
  );

  const applyScrollbackLines = useCallback(
    (next: string) => {
      const normalized = normalizeTerminalScrollbackLines(next);
      setScrollbackDraft(String(normalized));
      if (normalized === scrollbackLines) return;
      update({ scrollbackLines: normalized });
      window.dispatchEvent(
        new CustomEvent('terminal-scrollback-lines-changed', {
          detail: { scrollbackLines: normalized },
        })
      );
    },
    [scrollbackLines, update]
  );

  const selectedPreset = findPreset(fontFamily);
  const pickerLabel = fontFamily.trim()
    ? (selectedPreset?.label ?? `Custom: ${fontFamily.trim()}`)
    : 'Default (Menlo)';

  const filteredPopularOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return popularOptions;
    return popularOptions.filter((option) => option.label.toLowerCase().includes(query));
  }, [popularOptions, search]);

  const filteredInstalledOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return installedOptions;
    return installedOptions.filter((option) => option.label.toLowerCase().includes(query));
  }, [installedOptions, search]);

  const hasAnyResults = filteredPopularOptions.length > 0 || filteredInstalledOptions.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <SettingRow
        title={t('settings.terminal.font')}
        description={t('settings.terminal.fontDescription')}
        control={
          <div className="w-[183px] flex-shrink-0">
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 w-full justify-between text-sm font-normal"
                    disabled={loading || saving}
                  />
                }
              >
                <span className="truncate text-left">{pickerLabel}</span>
                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-70" />
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[260px] p-2">
                <div className="grid gap-2">
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      const typed = search.trim();
                      if (!typed) return;
                      setSearch('');
                      setPickerOpen(false);
                      applyFont(typed);
                    }}
                    placeholder={t('settings.terminal.searchFontPlaceholder')}
                    aria-label={t('settings.terminal.searchFontAria')}
                    className="h-8"
                  />
                  <div className="max-h-56 overflow-auto">
                    {filteredPopularOptions.length > 0 ? (
                      <>
                        <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {t('settings.terminal.popular')}
                        </div>
                        {filteredPopularOptions.map((option) => {
                          const selected =
                            selectedPreset?.fontValue.toLowerCase() ===
                            option.fontValue.toLowerCase();
                          return (
                            <button
                              key={option.id}
                              type="button"
                              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-background-1"
                              onClick={() => {
                                setSearch('');
                                setPickerOpen(false);
                                applyFont(option.fontValue);
                              }}
                            >
                              <span>{option.label}</span>
                              {selected ? <Check className="h-4 w-4 opacity-80" /> : null}
                            </button>
                          );
                        })}
                      </>
                    ) : null}

                    {filteredInstalledOptions.length > 0 || loadingFonts ? (
                      <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {t('settings.terminal.installedFonts')}
                      </div>
                    ) : null}

                    {loadingFonts ? (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">
                        {t('settings.terminal.loadingInstalled')}
                      </div>
                    ) : null}

                    {filteredInstalledOptions.map((option) => {
                      const selected =
                        selectedPreset?.fontValue.toLowerCase() === option.fontValue.toLowerCase();
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-background-1"
                          onClick={() => {
                            setSearch('');
                            setPickerOpen(false);
                            applyFont(option.fontValue);
                          }}
                        >
                          <span>{option.label}</span>
                          {selected ? <Check className="h-4 w-4 opacity-80" /> : null}
                        </button>
                      );
                    })}

                    {!loadingFonts && !hasAnyResults ? (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">
                        {t('settings.terminal.noFontsFound')}
                      </div>
                    ) : null}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        }
      />
      <SettingRow
        title={t('settings.terminal.scrollbackLines')}
        description={t('settings.terminal.scrollbackLinesDescription')}
        control={
          <div className="flex w-[183px] items-center gap-2">
            <Input
              type="number"
              min={MIN_TERMINAL_SCROLLBACK_LINES}
              max={MAX_TERMINAL_SCROLLBACK_LINES}
              step={1000}
              value={scrollbackDraft}
              disabled={loading || saving}
              aria-label={t('settings.terminal.scrollbackLinesAria')}
              className="h-8 text-right"
              onChange={(e) => setScrollbackDraft(e.target.value)}
              onBlur={() => {
                if (skipScrollbackCommitRef.current) {
                  skipScrollbackCommitRef.current = false;
                  return;
                }
                applyScrollbackLines(scrollbackDraft);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                  return;
                }
                if (e.key === 'Escape') {
                  skipScrollbackCommitRef.current = true;
                  setScrollbackDraft(String(scrollbackLines));
                  e.currentTarget.blur();
                }
              }}
            />
            <span className="shrink-0 text-xs text-foreground-passive">
              {t('settings.terminal.linesUnit')}
            </span>
          </div>
        }
      />
      <SettingRow
        title={t('settings.terminal.autoCopySelected')}
        description={t('settings.terminal.autoCopySelectedDescription')}
        control={
          <Switch
            checked={autoCopyOnSelection}
            disabled={loading || saving}
            onCheckedChange={toggleAutoCopy}
          />
        }
      />
    </div>
  );
};

export default TerminalSettingsCard;
