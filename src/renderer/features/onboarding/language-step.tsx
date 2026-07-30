import { Languages } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  changeAppLanguage,
  normalizeSupportedLanguage,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from '@renderer/lib/i18n';
import { Button } from '@renderer/lib/ui/button';
import { RadioGroup, RadioGroupItem } from '@renderer/lib/ui/radio-group';
import { cn } from '@renderer/utils/utils';

export function LanguageStep({ onComplete }: { onComplete: () => void }) {
  const { t, i18n } = useTranslation();
  const [current, setCurrent] = useState<SupportedLanguage>(() =>
    normalizeSupportedLanguage(i18n.resolvedLanguage ?? i18n.language)
  );

  const handleChange = (next: string) => {
    const language = normalizeSupportedLanguage(next);
    setCurrent(language);
    void changeAppLanguage(language);
  };

  return (
    <div className="flex w-full max-w-xl flex-col gap-8 px-8 py-10">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-background shadow-sm">
          <Languages className="size-5 text-foreground" strokeWidth={1.6} />
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-medium">{t('onboarding.language.title')}</h1>
          <p className="text-sm leading-6 text-foreground-muted">
            {t('onboarding.language.description')}
          </p>
        </div>
      </div>

      <RadioGroup
        value={current}
        onValueChange={handleChange}
        aria-label={t('onboarding.language.title')}
        className="grid-cols-1 @xl:grid-cols-2"
      >
        {SUPPORTED_LANGUAGES.map((language) => {
          const isSelected = language === current;
          return (
            <label
              key={language}
              className={cn(
                'flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border bg-background px-4 py-4 transition-colors',
                'hover:border-foreground-muted/50 hover:bg-background-1',
                isSelected && 'border-primary bg-background-1 shadow-sm'
              )}
            >
              <RadioGroupItem value={language} className="mt-0.5" />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-sm font-medium text-foreground">
                  {t(`language.${language}`)}
                </span>
                <span className="text-xs leading-5 text-foreground-muted">
                  {t(`onboarding.language.${language}.description`)}
                </span>
              </span>
            </label>
          );
        })}
      </RadioGroup>

      <Button size="lg" className="w-full" onClick={onComplete}>
        {t('onboarding.language.continueWith', {
          language: t(`language.${current}`),
        })}
      </Button>
    </div>
  );
}
