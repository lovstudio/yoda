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

describe('workspace Gateway placement', () => {
  it('renders the Gateway globally before the flexible status-bar spacer', () => {
    const source = readFileSync(
      new URL('../../app/workspace-runtime-bar.tsx', import.meta.url),
      'utf8'
    );
    const triggerIndex = source.indexOf("aria-label={t('workspaceRuntime.gateway.title')}");
    const spacerIndex = source.indexOf('<span className="flex-1" />', triggerIndex);
    const localRuntimeBlockEnd = source.lastIndexOf('      ) : null}', triggerIndex);

    expect(triggerIndex).toBeGreaterThan(localRuntimeBlockEnd);
    expect(spacerIndex).toBeGreaterThan(triggerIndex);
    expect(source).toContain('<GatewayRuntimeSources');
    expect(source).not.toContain('<span>MaaS</span>');
  });
});
