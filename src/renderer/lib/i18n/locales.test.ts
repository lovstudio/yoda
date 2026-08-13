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
    expect(i18n.t('sidebar.newTask')).toBe(zhCN.sidebar.newTask);

    await i18n.changeLanguage('en');
  });

  it('uses 模型接入 consistently as the Chinese product term', () => {
    expect(zhCN.sidebar.maas).toBe('模型接入');
    expect(zhCN.settings.tabs.maas).toBe('模型接入');
    expect(zhCN.maas.title).toBe('模型接入');
    expect(zhCN.workspaceRuntime.maas.title).toBe('模型接入');
    expect(JSON.stringify(zhCN)).not.toContain('MaaS');
  });

  it('shows only the active provider after the MaaS icon in the runtime bar', () => {
    expect(zhCN.workspaceRuntime.maas.providerSuffix).toBe('（{{provider}}）');
    expect(zhCN.workspaceRuntime.maas.labelWithProvider).toBe('模型接入（{{provider}}）');
    expect(en.workspaceRuntime.maas.providerSuffix).toBe('({{provider}})');
    expect(en.workspaceRuntime.maas.labelWithProvider).toBe('Model access ({{provider}})');
    expect(JSON.stringify(zhCN.workspaceRuntime.maas)).not.toContain('智慧处理');
  });

  it('resolves the model access global tab label in both locales', async () => {
    await i18n.changeLanguage('zh-CN');
    expect(i18n.t('sidebar.maas')).toBe('模型接入');

    await i18n.changeLanguage('en');
    expect(i18n.t('sidebar.maas')).toBe('Model access');
  });
});
