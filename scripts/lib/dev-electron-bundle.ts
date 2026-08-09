import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DEV_PRODUCT_NAME = 'Yoda';
const DEV_BUNDLE_ID = 'ai.lovstudio.yoda.dev';
const DEV_BUNDLE_CACHE_VERSION = '5';
const SOURCE_APP_NAME = 'Electron.app';
const SOURCE_EXECUTABLE_NAME = 'Electron';
const DEV_APP_NAME = 'Yoda.app';
const DEV_ICON_SOURCE = path.join('src', 'assets', 'images', 'yoda', 'yoda.icns');
const DEV_ICON_FILE = 'icon.icns';
const DEV_PROTOCOL_SCHEME = 'yoda';

const DEV_ELECTRON_BUNDLE_VALUES: Record<string, string> = {
  CFBundleName: DEV_PRODUCT_NAME,
  CFBundleDisplayName: DEV_PRODUCT_NAME,
  CFBundleIdentifier: DEV_BUNDLE_ID,
};

export function patchDevElectronBundleMetadata(repoRoot: string): void {
  if (process.platform !== 'darwin') return;

  patchBundleInfo(getSourceBundlePath(repoRoot), DEV_ELECTRON_BUNDLE_VALUES);
}

export function prepareDevElectronBundle(repoRoot: string): string | undefined {
  if (process.platform !== 'darwin') return undefined;

  const sourceBundlePath = getSourceBundlePath(repoRoot);
  const devBundlePath = getDevBundlePath(repoRoot);
  if (!existsSync(sourceBundlePath)) return undefined;

  const version = readElectronVersion(repoRoot);
  const markerValue = `${version}:${DEV_BUNDLE_CACHE_VERSION}`;
  const markerPath = path.join(devBundlePath, 'Contents', '.yoda-dev-electron-version');
  const existingVersion = existsSync(markerPath) ? readFileSync(markerPath, 'utf8') : undefined;

  if (!existsSync(devBundlePath) || existingVersion !== markerValue) {
    rmSync(devBundlePath, { recursive: true, force: true });
    mkdirSync(path.dirname(devBundlePath), { recursive: true });
    cpSync(sourceBundlePath, devBundlePath, { recursive: true, verbatimSymlinks: true });
  }

  patchBundleInfo(devBundlePath, {
    ...DEV_ELECTRON_BUNDLE_VALUES,
    CFBundleExecutable: SOURCE_EXECUTABLE_NAME,
    CFBundleIconFile: DEV_ICON_FILE,
  });
  patchBundleUrlScheme(devBundlePath, {
    name: DEV_PRODUCT_NAME,
    scheme: DEV_PROTOCOL_SCHEME,
  });
  patchBundleDocumentTypes(devBundlePath);
  installDevBundleIcon(repoRoot, devBundlePath);
  writeFileSync(markerPath, markerValue);
  // 原地替换 icns 后 iconservices 仍会按 bundle 缓存旧图标，touch 让缓存失效
  spawnSync('/usr/bin/touch', [devBundlePath], { stdio: 'ignore' });
  registerBundle(devBundlePath);

  const executablePath = path.join(devBundlePath, 'Contents', 'MacOS', SOURCE_EXECUTABLE_NAME);
  return existsSync(executablePath) ? executablePath : undefined;
}

function getSourceBundlePath(repoRoot: string): string {
  return path.join(repoRoot, 'node_modules', 'electron', 'dist', SOURCE_APP_NAME);
}

function getDevBundlePath(repoRoot: string): string {
  return path.join(repoRoot, 'node_modules', '.cache', 'yoda', 'dev-electron', DEV_APP_NAME);
}

function readElectronVersion(repoRoot: string): string {
  const versionPath = path.join(repoRoot, 'node_modules', 'electron', 'dist', 'version');
  return existsSync(versionPath) ? readFileSync(versionPath, 'utf8').trim() : 'unknown';
}

function patchBundleInfo(bundlePath: string, values: Record<string, string>): void {
  const plist = path.join(bundlePath, 'Contents', 'Info.plist');
  if (!existsSync(plist)) return;

  for (const [key, value] of Object.entries(values)) {
    upsertPlistString(plist, key, value);
  }
}

function installDevBundleIcon(repoRoot: string, bundlePath: string): void {
  const sourceIcon = path.join(repoRoot, DEV_ICON_SOURCE);
  const resourcesPath = path.join(bundlePath, 'Contents', 'Resources');
  if (!existsSync(sourceIcon) || !existsSync(resourcesPath)) return;

  cpSync(sourceIcon, path.join(resourcesPath, DEV_ICON_FILE));
}

function registerBundle(bundlePath: string): void {
  spawnSync(
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
    ['-f', bundlePath],
    { stdio: 'ignore' }
  );
}

function upsertPlistString(plist: string, key: string, value: string): void {
  const setResult = spawnSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist], {
    stdio: 'ignore',
  });

  if (setResult.status === 0) return;

  spawnSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, plist], {
    stdio: 'ignore',
  });
}

function patchBundleUrlScheme(bundlePath: string, args: { name: string; scheme: string }): void {
  const plist = path.join(bundlePath, 'Contents', 'Info.plist');
  if (!existsSync(plist)) return;

  spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Delete :CFBundleURLTypes', plist], {
    stdio: 'ignore',
  });
  for (const command of [
    'Add :CFBundleURLTypes array',
    'Add :CFBundleURLTypes:0 dict',
    'Add :CFBundleURLTypes:0:CFBundleTypeRole string Editor',
    `Add :CFBundleURLTypes:0:CFBundleURLName string ${args.name}`,
    'Add :CFBundleURLTypes:0:CFBundleURLSchemes array',
    `Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string ${args.scheme}`,
  ]) {
    spawnSync('/usr/libexec/PlistBuddy', ['-c', command, plist], { stdio: 'ignore' });
  }
}

function patchBundleDocumentTypes(bundlePath: string): void {
  const plist = path.join(bundlePath, 'Contents', 'Info.plist');
  if (!existsSync(plist)) return;

  spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Delete :CFBundleDocumentTypes', plist], {
    stdio: 'ignore',
  });
  for (const command of [
    'Add :CFBundleDocumentTypes array',
    'Add :CFBundleDocumentTypes:0 dict',
    `Add :CFBundleDocumentTypes:0:CFBundleTypeName string ${DEV_PRODUCT_NAME} Document`,
    'Add :CFBundleDocumentTypes:0:CFBundleTypeRole string Editor',
    'Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions array',
  ]) {
    spawnSync('/usr/libexec/PlistBuddy', ['-c', command, plist], { stdio: 'ignore' });
  }

  const extensions = [
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'bmp',
    'ico',
    'svg',
    'pdf',
    'txt',
    'md',
    'mdx',
    'json',
    'js',
    'jsx',
    'ts',
    'tsx',
    'css',
    'scss',
    'html',
    'xml',
    'yaml',
    'yml',
    'toml',
    'env',
    'log',
  ];
  for (const [index, extension] of extensions.entries()) {
    spawnSync(
      '/usr/libexec/PlistBuddy',
      [
        '-c',
        `Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions:${index} string ${extension}`,
        plist,
      ],
      { stdio: 'ignore' }
    );
  }
}
