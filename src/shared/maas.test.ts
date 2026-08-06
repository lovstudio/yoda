import { describe, expect, it } from 'vitest';
import {
  createCustomMaasPlatformId,
  createMaasProfileId,
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

  it('creates independent profiles for the same cloud target platform', () => {
    const first = createMaasProfileId('zenmux', 'first-key');
    const second = createMaasProfileId('zenmux', 'second-key');

    expect(first).toBe('zenmux:first-key');
    expect(second).toBe('zenmux:second-key');
    expect(first).not.toBe(second);
    expect(isMaasPlatformId(first)).toBe(true);
    expect(getMaasPlatformTemplateId(first)).toBe('zenmux');
  });

  it('provides a local LiteLLM Gateway preset that supports Responses API routing', () => {
    expect(isMaasPlatformId('litellm')).toBe(true);
    expect(getMaasPlatformDefinition('litellm')).toMatchObject({
      id: 'litellm',
      name: 'LiteLLM',
      defaultEndpoint: 'http://127.0.0.1:4000/v1',
    });
  });

  it('provides a separate local New API preset for its lightweight managed container', () => {
    expect(isMaasPlatformId('newapi')).toBe(true);
    expect(getMaasPlatformDefinition('newapi')).toMatchObject({
      id: 'newapi',
      name: 'New API',
      defaultEndpoint: 'http://127.0.0.1:4001/v1',
      category: 'self-hosted-gateway',
    });
  });

  it('provides a local CLIProxyAPI preset for CLI and OAuth account routing', () => {
    expect(isMaasPlatformId('cliproxyapi')).toBe(true);
    expect(getMaasPlatformDefinition('cliproxyapi')).toMatchObject({
      id: 'cliproxyapi',
      name: 'CLIProxyAPI',
      category: 'self-hosted-gateway',
      defaultEndpoint: 'http://127.0.0.1:8317/v1',
    });
  });

  it('classifies vendor-operated model services as hosted platforms', () => {
    expect(getMaasPlatformDefinition('zenmux').category).toBe('hosted-platform');
    expect(getMaasPlatformDefinition('openrouter').category).toBe('hosted-platform');
    expect(getMaasPlatformDefinition('siliconflow').category).toBe('hosted-platform');
  });
});
