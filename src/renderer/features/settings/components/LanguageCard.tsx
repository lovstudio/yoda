import React from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeSupportedLanguage, SUPPORTED_LANGUAGES } from '@renderer/lib/i18n';
import { useAppLanguage } from '@renderer/lib/i18n/use-app-language';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { SettingRow } from './SettingRow';

const LanguageCard: React.FC = () => {
  const { t } = useTranslation();
  const { currentLanguage, setLanguage } = useAppLanguage();

  const handleChange = (next: string | null) => {
    if (!next) return;
    setLanguage(next);
  };

  const renderLanguageLabel = (value: unknown) => {
    const language =
      typeof value === 'string' ? normalizeSupportedLanguage(value) : currentLanguage;
    return t(`language.${language}`);
  };

  return (
    <SettingRow
      title={t('settings.language.title')}
      description={t('settings.language.description')}
      control={
        <div className="w-[183px] shrink-0">
          <Select value={currentLanguage} onValueChange={handleChange}>
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
