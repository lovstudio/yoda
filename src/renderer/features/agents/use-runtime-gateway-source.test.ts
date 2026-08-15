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
  it('renders global MaaS independently from the current Agent account', () => {
    const source = readFileSync(
      new URL('../../app/workspace-runtime-bar.tsx', import.meta.url),
      'utf8'
    );
    const accountIndex = source.indexOf(
      '{maasActiveForRuntime || shortAccountWindow || officialCodexAccountAvailable'
    );
    const accountEnd = source.indexOf('<span className="flex-1" />', accountIndex);
    // The opening tag carries more props than fit on one line, so match the
    // props that pin the placement rather than a formatted literal.
    const popoverMatch =
      /<Popover\s+open=\{isMaasPopoverOpen\}\s+onOpenChange=\{setIsMaasPopoverOpen\}/.exec(
        source.slice(accountEnd)
      );
    const popoverIndex = popoverMatch ? accountEnd + popoverMatch.index : -1;
    const selectorIndex = source.indexOf('<WorkspaceMaasPopover', popoverIndex);
    const spacerIndex = source.indexOf('<span className="flex-1" />');
    const terminalIndex = source.indexOf("title={t('workspaceRuntime.terminal')}", spacerIndex);

    expect(accountIndex).toBeGreaterThanOrEqual(0);
    expect(accountEnd).toBeGreaterThan(accountIndex);
    expect(popoverIndex).toBeGreaterThan(accountEnd);
    expect(selectorIndex).toBeGreaterThan(popoverIndex);
    expect(spacerIndex).toBeLessThan(selectorIndex);
    expect(terminalIndex).toBeGreaterThan(spacerIndex);
    expect(source.match(/<WorkspaceMaasPopover/g)).toHaveLength(1);
    expect(source).toContain('aria-label={maasTriggerLabel}');
    expect(source).toContain('const maasPresentation = useMemo(');
    expect(source).toContain('getWorkspaceMaasPresentation(');
    expect(source).not.toContain('maasAccount');
    expect(source).not.toContain('<GatewayRuntimeSources');
  });
});
