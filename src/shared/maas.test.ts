import { describe, expect, it } from 'vitest';
import { resolveMaasEnvKey } from './maas';

describe('resolveMaasEnvKey', () => {
  it('keeps the conventional key for the default Profile name', () => {
    expect(resolveMaasEnvKey('zenmux', 'ZenMux')).toBe('ZENMUX_API_KEY');
  });

  it('derives a distinct key when another Profile uses a different name', () => {
    expect(resolveMaasEnvKey('zenmux:secondary', 'ZenMux 2')).toBe('ZENMUX_2_API_KEY');
  });

  it('preserves an explicitly customized environment key', () => {
    expect(resolveMaasEnvKey('zenmux:secondary', 'ZenMux 2', 'TEAM_ZENMUX_KEY')).toBe(
      'TEAM_ZENMUX_KEY'
    );
  });
});
