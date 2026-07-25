import { describe, expect, it } from 'vitest';
import { parseGatewaySelection } from './gateway-selection';

describe('gateway selection', () => {
  it('preserves the complete dynamic Custom instance ID', () => {
    expect(parseGatewaySelection('yoda-maas:custom:first-instance')).toEqual({
      authProvider: 'yoda-maas',
      maasPlatformId: 'custom:first-instance',
    });
  });

  it('parses direct account providers without a MaaS instance', () => {
    expect(parseGatewaySelection('official-api')).toEqual({ authProvider: 'official-api' });
  });
});
