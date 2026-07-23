import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LANGUAGE_STORAGE_KEY,
  normalizeSupportedLanguage,
  type SupportedLanguage,
} from '@renderer/lib/i18n';

/** Shared app-language state for settings and compact language controls. */
export function useAppLanguage() {
  const { i18n } = useTranslation();
  const [currentLanguage, setCurrentLanguage] = useState<SupportedLanguage>(() =>
    normalizeSupportedLanguage(i18n.resolvedLanguage ?? i18n.language)
  );

  useEffect(() => {
    const syncCurrent = (language?: string) => {
      setCurrentLanguage(
        normalizeSupportedLanguage(language ?? i18n.resolvedLanguage ?? i18n.language)
      );
    };

    syncCurrent();
    i18n.on('languageChanged', syncCurrent);
    return () => {
      i18n.off('languageChanged', syncCurrent);
    };
  }, [i18n]);

  const setLanguage = useCallback(
    (next: string) => {
      const language = normalizeSupportedLanguage(next);
      setCurrentLanguage(language);
      try {
        window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
      } catch {
        // Persistence is best-effort.
      }
      void i18n.changeLanguage(language);
    },
    [i18n]
  );

  return { currentLanguage, setLanguage };
}
