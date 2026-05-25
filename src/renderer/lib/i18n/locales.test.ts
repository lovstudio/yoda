import { describe, expect, it } from 'vitest';
import i18n from './index';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }

  return Object.entries(value).flatMap(([key, child]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    return flattenKeys(child, nextPrefix);
  });
}

describe('i18n locales', () => {
  it('keeps locale keys in sync', () => {
    const enKeys = new Set(flattenKeys(en));
    const zhCNKeys = new Set(flattenKeys(zhCN));

    const missingInZhCN = [...enKeys].filter((key) => !zhCNKeys.has(key)).sort();
    const missingInEn = [...zhCNKeys].filter((key) => !enKeys.has(key)).sort();

    expect(missingInZhCN).toEqual([]);
    expect(missingInEn).toEqual([]);
  });

  it('resolves zh-CN to Chinese resources', async () => {
    await i18n.changeLanguage('zh-CN');

    expect(i18n.resolvedLanguage).toBe('zh-CN');
    expect(i18n.t('sidebar.newSession')).toBe(zhCN.sidebar.newSession);

    await i18n.changeLanguage('en');
  });
});
