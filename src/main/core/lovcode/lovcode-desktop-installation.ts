import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const LOVCODE_MAC_BUNDLE_ID = 'app.lovpen.code';
const PLIST_TIMEOUT_MS = 3_000;

export type LovcodeDesktopInstallation = {
  version: string | null;
  executablePath: string;
};

export type LovcodeDesktopProbe = {
  platform: NodeJS.Platform;
  homeDirectory: string;
  accessExecutable: (filePath: string) => Promise<void>;
  readPlistValue: (infoPlistPath: string, key: string) => Promise<string>;
};

const defaultProbe: LovcodeDesktopProbe = {
  platform: process.platform,
  homeDirectory: homedir(),
  accessExecutable: (filePath) => access(filePath, constants.X_OK),
  readPlistValue: async (infoPlistPath, key) => {
    const { stdout } = await execFileAsync(
      '/usr/bin/plutil',
      ['-extract', key, 'raw', '-o', '-', infoPlistPath],
      {
        timeout: PLIST_TIMEOUT_MS,
        encoding: 'utf8',
      }
    );
    return stdout.trim();
  },
};

export async function detectLovcodeDesktopInstallation(
  probe: LovcodeDesktopProbe = defaultProbe
): Promise<LovcodeDesktopInstallation | null> {
  if (probe.platform !== 'darwin') return null;

  const appBundles = [
    '/Applications/Lovcode.app',
    path.join(probe.homeDirectory, 'Applications', 'Lovcode.app'),
  ];

  for (const appBundle of appBundles) {
    const infoPlistPath = path.join(appBundle, 'Contents', 'Info.plist');
    try {
      const bundleId = await probe.readPlistValue(infoPlistPath, 'CFBundleIdentifier');
      if (bundleId !== LOVCODE_MAC_BUNDLE_ID) continue;

      const executableName = await probe.readPlistValue(infoPlistPath, 'CFBundleExecutable');
      const executablePath = path.join(appBundle, 'Contents', 'MacOS', executableName);
      await probe.accessExecutable(executablePath);

      let version: string | null = null;
      try {
        version = (await probe.readPlistValue(infoPlistPath, 'CFBundleShortVersionString')) || null;
      } catch {
        // The executable is enough to establish installation; version is optional.
      }
      return { version, executablePath };
    } catch {
      // Try the next standard application directory.
    }
  }

  return null;
}
