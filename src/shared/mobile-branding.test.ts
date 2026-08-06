import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('mobile branding', () => {
  it('uses a full-bleed app icon and the shared Yoda mark in the connection screen', () => {
    const appConfig = JSON.parse(
      readFileSync(new URL('../../apps/mobile/app.json', import.meta.url), 'utf8')
    ) as { expo?: { icon?: string } };
    const appSource = readFileSync(
      new URL('../../apps/mobile/src/App.tsx', import.meta.url),
      'utf8'
    );

    expect(appConfig.expo?.icon).toBe('../../src/assets/images/yoda/yoda-mobile-icon.png');
    expect(appSource).toContain("from '../../../src/assets/images/yoda/yoda_logo.png'");
    expect(appSource.match(/<YodaBrandMark size=\{52\} \/>/g)).toHaveLength(1);
    expect(appSource).not.toContain('git-network-outline');
  });
});
