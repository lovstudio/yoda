import { describe, expect, it, vi } from 'vitest';
import {
  detectLovcodeDesktopInstallation,
  type LovcodeDesktopProbe,
} from './lovcode-desktop-installation';

function makeProbe(overrides: Partial<LovcodeDesktopProbe> = {}): LovcodeDesktopProbe {
  return {
    platform: 'darwin',
    homeDirectory: '/Users/tester',
    accessExecutable: vi.fn(async () => {}),
    readPlistValue: vi.fn(async (_infoPlistPath, key) => {
      if (key === 'CFBundleIdentifier') return 'app.lovpen.code';
      if (key === 'CFBundleExecutable') return 'lovcode';
      if (key === 'CFBundleShortVersionString') return '0.39.9';
      throw new Error(`Unexpected plist key: ${key}`);
    }),
    ...overrides,
  };
}

describe('detectLovcodeDesktopInstallation', () => {
  it('detects the macOS app bundle and reads its version', async () => {
    const probe = makeProbe();

    await expect(detectLovcodeDesktopInstallation(probe)).resolves.toEqual({
      version: '0.39.9',
    });
    expect(probe.accessExecutable).toHaveBeenCalledWith(
      '/Applications/Lovcode.app/Contents/MacOS/lovcode'
    );
  });

  it('checks the user Applications directory when the system app is absent', async () => {
    const accessExecutable = vi
      .fn<(filePath: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('missing'))
      .mockResolvedValueOnce();
    const probe = makeProbe({ accessExecutable });

    await expect(detectLovcodeDesktopInstallation(probe)).resolves.toEqual({
      version: '0.39.9',
    });
    expect(accessExecutable).toHaveBeenLastCalledWith(
      '/Users/tester/Applications/Lovcode.app/Contents/MacOS/lovcode'
    );
  });

  it('does not infer a desktop installation on other platforms', async () => {
    const probe = makeProbe({ platform: 'linux' });

    await expect(detectLovcodeDesktopInstallation(probe)).resolves.toBeNull();
    expect(probe.readPlistValue).not.toHaveBeenCalled();
  });
});
