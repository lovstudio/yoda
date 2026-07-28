import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shouldNotarizeMacBuild } from '@root/scripts/release/lib/mac-notarization';

beforeEach(() => {
  for (const name of [
    'YODA_DISABLE_MAC_SIGNING',
    'APPLE_ID',
    'APPLE_APP_SPECIFIC_PASSWORD',
    'APPLE_TEAM_ID',
    'APPLE_API_KEY',
    'APPLE_API_KEY_ID',
    'APPLE_API_ISSUER',
  ]) {
    vi.stubEnv(name, '');
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('macOS build notarization', () => {
  it('enables notarization for complete Apple ID credentials', () => {
    vi.stubEnv('APPLE_ID', 'release@example.test');
    vi.stubEnv('APPLE_APP_SPECIFIC_PASSWORD', 'app-password');
    vi.stubEnv('APPLE_TEAM_ID', 'TEAM123456');

    expect(shouldNotarizeMacBuild()).toBe(true);
  });

  it('enables notarization for complete App Store Connect API credentials', () => {
    vi.stubEnv('APPLE_API_KEY', 'base64-key');
    vi.stubEnv('APPLE_API_KEY_ID', 'KEY123');
    vi.stubEnv('APPLE_API_ISSUER', 'issuer-id');

    expect(shouldNotarizeMacBuild()).toBe(true);
  });

  it('keeps local builds offline when credentials are incomplete', () => {
    vi.stubEnv('APPLE_ID', 'release@example.test');
    vi.stubEnv('APPLE_APP_SPECIFIC_PASSWORD', '');
    vi.stubEnv('APPLE_TEAM_ID', 'TEAM123456');

    expect(shouldNotarizeMacBuild()).toBe(false);
  });

  it('honors the explicit signing disable switch', () => {
    vi.stubEnv('YODA_DISABLE_MAC_SIGNING', '1');
    vi.stubEnv('APPLE_ID', 'release@example.test');
    vi.stubEnv('APPLE_APP_SPECIFIC_PASSWORD', 'app-password');
    vi.stubEnv('APPLE_TEAM_ID', 'TEAM123456');

    expect(shouldNotarizeMacBuild()).toBe(false);
  });
});
