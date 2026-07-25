import { describe, expect, it } from 'vitest';
import {
  createCustomMaasPlatformId,
  getMaasPlatformDefinition,
  getMaasPlatformTemplateId,
  isMaasPlatformId,
} from './maas';

describe('MaaS platform instances', () => {
  it('creates independent Custom instance IDs that resolve to the Custom template', () => {
    const first = createCustomMaasPlatformId('first');
    const second = createCustomMaasPlatformId('second');

    expect(first).toBe('custom:first');
    expect(second).toBe('custom:second');
    expect(first).not.toBe(second);
    expect(isMaasPlatformId(first)).toBe(true);
    expect(getMaasPlatformTemplateId(first)).toBe('custom');
    expect(getMaasPlatformDefinition(first).name).toBe('Custom');
  });

  it('keeps the legacy fixed Custom ID valid', () => {
    expect(isMaasPlatformId('custom')).toBe(true);
    expect(getMaasPlatformTemplateId('custom')).toBe('custom');
  });
});
