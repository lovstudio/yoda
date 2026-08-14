import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveDefaultGatewaySource } from './gateway-source';

describe('resolveDefaultGatewaySource', () => {
  it('prefers an explicitly configured API source before the CLI subscription fallback', () => {
    expect(
      resolveDefaultGatewaySource({
        'official-api': true,
        'official-subscription': true,
        'yoda-maas': true,
      })
    ).toBe('official-api');
  });

  it('falls back through subscription and MaaS availability', () => {
    expect(
      resolveDefaultGatewaySource({
        'official-api': false,
        'official-subscription': true,
        'yoda-maas': true,
      })
    ).toBe('official-subscription');
    expect(
      resolveDefaultGatewaySource({
        'official-api': false,
        'official-subscription': false,
        'yoda-maas': true,
      })
    ).toBe('yoda-maas');
  });
});

describe('workspace MaaS placement', () => {
  it('renders the global MaaS selector inside the active account popover', () => {
    const source = readFileSync(
      new URL('../../app/workspace-runtime-bar.tsx', import.meta.url),
      'utf8'
    );
    const accountIndex = source.indexOf('{maasAccount ? (');
    const popoverIndex = source.indexOf(
      '<Popover open={isMaasPopoverOpen} onOpenChange={setIsMaasPopoverOpen}>',
      accountIndex
    );
    const selectorIndex = source.indexOf('<MaasGlobalSelector', popoverIndex);
    const officialAccountIndex = source.indexOf(
      'shortAccountWindow || officialCodexAccountAvailable',
      selectorIndex
    );
    const spacerIndex = source.indexOf('<span className="flex-1" />');
    const terminalIndex = source.indexOf("title={t('workspaceRuntime.terminal')}", spacerIndex);

    expect(accountIndex).toBeGreaterThanOrEqual(0);
    expect(popoverIndex).toBeGreaterThan(accountIndex);
    expect(selectorIndex).toBeGreaterThan(popoverIndex);
    expect(officialAccountIndex).toBeGreaterThan(selectorIndex);
    expect(spacerIndex).toBeGreaterThan(selectorIndex);
    expect(terminalIndex).toBeGreaterThan(spacerIndex);
    expect(source.match(/<MaasGlobalSelector/g)).toHaveLength(1);
    expect(source).not.toContain('aria-label={maasTriggerLabel}');
    expect(source).not.toContain('const maasPresentation = useMemo(');
    expect(source).not.toContain('getWorkspaceMaasPresentation(');
    expect(source).not.toContain('<GatewayRuntimeSources');
  });
});
