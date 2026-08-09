import type { Configuration } from 'electron-builder';
import { shouldNotarizeMacBuild } from './scripts/release/lib/mac-notarization';
import {
  APP_ID,
  APP_NAME_LOWER,
  ARTIFACT_PREFIX,
  PRODUCT_NAME,
  UPDATE_CHANNEL,
  UPDATE_FEED_BASE_URL,
} from './src/shared/app-identity';
import { SPARKLE_PUBLIC_ED_KEY } from './src/shared/sparkle-signing';

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

const imageFileTypes = [
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
  ['bmp', 'image/bmp'],
  ['ico', 'image/vnd.microsoft.icon'],
] as const;

const documentFileTypes = [
  ['svg', 'image/svg+xml'],
  ['pdf', 'application/pdf'],
  ['txt', 'text/plain'],
  ['md', 'text/markdown'],
  ['mdx', 'text/markdown'],
  ['json', 'application/json'],
  ['js', 'text/javascript'],
  ['jsx', 'text/javascript'],
  ['ts', 'text/x-typescript'],
  ['tsx', 'text/x-typescript'],
  ['css', 'text/css'],
  ['scss', 'text/x-scss'],
  ['html', 'text/html'],
  ['xml', 'application/xml'],
  ['yaml', 'application/yaml'],
  ['yml', 'application/yaml'],
  ['toml', 'application/toml'],
  ['env', 'text/plain'],
  ['log', 'text/plain'],
] as const;

const config: Configuration = {
  appId: APP_ID,
  productName: PRODUCT_NAME,
  directories: { output: 'release' },
  artifactName: `${ARTIFACT_PREFIX}-\${arch}.\${ext}`,
  protocols: [{ name: PRODUCT_NAME, schemes: [APP_NAME_LOWER] }],
  fileAssociations: [
    ...imageFileTypes.map(([ext, mimeType]) => ({
      ext,
      mimeType,
      name: 'Image',
      description: 'Image file',
      role: 'Editor',
    })),
    ...documentFileTypes.map(([ext, mimeType]) => ({
      ext,
      mimeType,
      name: 'Document',
      description: 'Text or document file',
      role: 'Editor',
    })),
  ],
  publish: [
    {
      provider: 'generic',
      url: UPDATE_FEED_BASE_URL,
      channel: UPDATE_CHANNEL,
    },
  ],
  generateUpdatesFilesForAllChannels: false,
  extraResources: ['LICENSE.md'],
  extraFiles:
    process.platform === 'darwin'
      ? [
          {
            from: 'build/sparkle/YodaSparkleUpdater',
            to: 'Helpers/YodaSparkleUpdater',
          },
          {
            from: 'build/sparkle/Sparkle.framework',
            to: 'Frameworks/Sparkle.framework',
          },
        ]
      : [],
  // node_modules 不写进 files：electron-builder 自动收集 production dependencies
  // （仅 native 模块 + ssh2，其余依赖已由 electron-vite 打进 out/）
  files: ['out/**/*', 'drizzle/**/*'],
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
    target: [{ target: 'dmg', arch: ['arm64'] }],
    icon: 'src/assets/images/yoda/yoda.icns',
    notarize: shouldNotarizeMacBuild(),
    extendInfo: {
      SUPublicEDKey: SPARKLE_PUBLIC_ED_KEY,
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    },
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
