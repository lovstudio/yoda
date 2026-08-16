import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readRuntimeBarSource } from '@renderer/app/runtime-bar/test-helpers/read-bar-source';
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
    const source = readRuntimeBarSource();
    const registry = readFileSync(
      new URL('../../app/runtime-bar/registry.ts', import.meta.url),
      'utf8'
    );
    // Placement is data now: account quota rides the session group, routing and
    // the terminal sit in the tray, in that order.
    const accountEntry = registry.indexOf("{ id: 'account-usage', slot: 'session'");
    const maasEntry = registry.indexOf("{ id: 'maas', slot: 'tray'");
    const terminalEntry = registry.indexOf("{ id: 'terminal', slot: 'tray'");

    expect(accountEntry).toBeGreaterThanOrEqual(0);
    expect(maasEntry).toBeGreaterThan(accountEntry);
    expect(terminalEntry).toBeGreaterThan(maasEntry);
    expect(source.match(/<WorkspaceMaasPopover/g)).toHaveLength(1);
    expect(source).toContain('aria-label={maasTriggerLabel}');
    expect(source).toContain('const presentation = useMemo(');
    expect(source).toContain('getWorkspaceMaasPresentation(');
    expect(source).not.toContain('maasAccount');
    expect(source).not.toContain('<GatewayRuntimeSources');
  });
});
