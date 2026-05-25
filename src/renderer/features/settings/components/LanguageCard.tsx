import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LANGUAGE_STORAGE_KEY,
  normalizeSupportedLanguage,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from '@renderer/lib/i18n';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { SettingRow } from './SettingRow';

const LanguageCard: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [current, setCurrent] = useState<SupportedLanguage>(() =>
    normalizeSupportedLanguage(i18n.resolvedLanguage ?? i18n.language)
  );

  useEffect(() => {
    const syncCurrent = (language?: string) => {
      setCurrent(normalizeSupportedLanguage(language ?? i18n.resolvedLanguage ?? i18n.language));
    };

    syncCurrent();
    i18n.on('languageChanged', syncCurrent);
    return () => {
      i18n.off('languageChanged', syncCurrent);
    };
  }, [i18n]);

  const handleChange = (next: string | null) => {
    if (!next) return;
    const language = normalizeSupportedLanguage(next);
    setCurrent(language);
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      /* ignore */
    }
    void i18n.changeLanguage(language);
  };

  const renderLanguageLabel = (value: unknown) => {
    const language = typeof value === 'string' ? normalizeSupportedLanguage(value) : current;
    return t(`language.${language}`);
  };

  return (
    <SettingRow
      title={t('settings.language.title')}
      description={t('settings.language.description')}
      control={
        <div className="w-[183px] shrink-0">
          <Select value={current} onValueChange={handleChange}>
            <SelectTrigger className="w-full">
              <SelectValue>{renderLanguageLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_LANGUAGES.map((lng) => (
                <SelectItem key={lng} value={lng}>
                  {t(`language.${lng}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
    />
  );
};

export default LanguageCard;
