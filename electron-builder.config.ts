import type { Configuration } from 'electron-builder';
import {
  APP_ID,
  APP_NAME_LOWER,
  ARTIFACT_PREFIX,
  PRODUCT_NAME,
  UPDATE_CHANNEL,
  UPDATE_FEED_BASE_URL,
} from './src/shared/app-identity';

const winSigning =
  process.env.YODA_DISABLE_WIN_SIGNING === '1'
    ? {}
    : {
        azureSignOptions: {
          publisherName: 'LovStudio',
          endpoint: 'https://eus.codesigning.azure.net/',
          certificateProfileName: 'yoda-public',
          codeSigningAccountName: 'yoda',
        },
      };

const macSigning =
  process.env.YODA_DISABLE_MAC_SIGNING === '1' ? { identity: null as unknown as string } : {};

const config: Configuration = {
  appId: APP_ID,
  productName: PRODUCT_NAME,
  directories: { output: 'release' },
  artifactName: `${ARTIFACT_PREFIX}-\${arch}.\${ext}`,
  protocols: [{ name: PRODUCT_NAME, schemes: [APP_NAME_LOWER] }],
  publish: [
    {
      provider: 'generic',
      url: UPDATE_FEED_BASE_URL,
      channel: UPDATE_CHANNEL,
    },
  ],
  generateUpdatesFilesForAllChannels: false,
  extraResources: ['LICENSE.md'],
  files: ['out/**/*', 'node_modules/**/*', 'drizzle/**/*'],
  asarUnpack: [
    'node_modules/better-sqlite3/**',
    'node_modules/node-pty/**',
    'node_modules/@parcel/watcher/**',
    '**/*.node',
  ],
  mac: {
    category: 'public.app-category.developer-tools',
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    target: [
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] },
    ],
    icon: 'src/assets/images/yoda/yoda.icns',
    notarize: false,
    ...macSigning,
  },
  dmg: {
    icon: 'src/assets/images/yoda/yoda.icns',
  },
  linux: {
    category: 'Development',
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
      { target: 'rpm', arch: ['x64'] },
    ],
  },
  win: {
    icon: 'src/assets/images/yoda/icon-dock.png',
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'msi', arch: ['x64'] },
    ],
    ...winSigning,
  },
  msi: {
    oneClick: false,
    perMachine: false,
  },
  nsis: {
    differentialPackage: true,
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
  },
  npmRebuild: false,
};

export default config;
