import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageStep } from '@renderer/features/onboarding/language-step';
import i18n, { LANGUAGE_STORAGE_KEY } from '@renderer/lib/i18n';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('LanguageStep', () => {
  let host: HTMLDivElement;
  let root: Root;
  let previousLanguage: string;
  let previousStoredLanguage: string | null;

  beforeEach(async () => {
    previousLanguage = i18n.resolvedLanguage ?? i18n.language;
    previousStoredLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    await i18n.changeLanguage('zh-CN');

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    await i18n.changeLanguage(previousLanguage);

    if (previousStoredLanguage === null) {
      window.localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, previousStoredLanguage);
    }
  });

  it('applies and persists the selected language before continuing', async () => {
    const onComplete = vi.fn();
    await act(async () => root.render(createElement(LanguageStep, { onComplete })));

    const englishOption = Array.from(host.querySelectorAll<HTMLElement>('[role="radio"]')).at(1);
    expect(englishOption).toBeDefined();

    await act(async () => englishOption?.click());
    await vi.waitFor(() => expect(i18n.resolvedLanguage).toBe('en'));

    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
    expect(host.textContent).toContain('Choose your language');
    expect(englishOption?.getAttribute('aria-checked')).toBe('true');

    const continueButton = Array.from(host.querySelectorAll('button')).find((element) =>
      element.textContent?.includes('Continue in English')
    );
    expect(continueButton).toBeDefined();

    await act(async () => continueButton?.click());
    expect(onComplete).toHaveBeenCalledOnce();
  });
});
