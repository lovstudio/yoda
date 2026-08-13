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
  it('renders the global MaaS selector in the right-side action area', () => {
    const source = readFileSync(
      new URL('../../app/workspace-runtime-bar.tsx', import.meta.url),
      'utf8'
    );
    const triggerIndex = source.indexOf('aria-label={maasTriggerLabel}');
    const triggerEnd = source.indexOf('</PopoverTrigger>', triggerIndex);
    const triggerSource = source.slice(triggerIndex, triggerEnd);
    const spacerIndex = source.indexOf('<span className="flex-1" />');
    const terminalIndex = source.indexOf("title={t('workspaceRuntime.terminal')}", triggerIndex);
    const localRuntimeBlockEnd = source.lastIndexOf('      ) : null}', triggerIndex);

    expect(triggerIndex).toBeGreaterThan(localRuntimeBlockEnd);
    expect(triggerIndex).toBeGreaterThan(spacerIndex);
    expect(terminalIndex).toBeGreaterThan(triggerIndex);
    expect(source).toContain('<MaasGlobalSelector');
    expect(source).toContain("t('workspaceRuntime.maas.labelWithProvider'");
    expect(source).toContain(": t('workspaceRuntime.maas.title');");
    expect(source).toContain('const maasPresentation = useMemo(');
    expect(source).toContain(
      'getWorkspaceMaasPresentation(globalMaasBinding.data, maasConnections)'
    );
    expect(source).not.toContain('<GatewayRuntimeSources');
    expect(triggerSource).toContain("? 'bg-background-2 text-foreground'");
    expect(triggerSource).toContain('title={maasTriggerLabel}');
    expect(triggerSource).toContain("t('workspaceRuntime.maas.providerSuffix'");
    expect(triggerSource).toContain('{maasPresentation.providerName ? (');
    expect(triggerSource).toContain('className="inline-block max-w-48 truncate"');
    expect(triggerSource).not.toContain('RUNTIME_BAR_ACTION_LABEL_CLASS');
  });
});
