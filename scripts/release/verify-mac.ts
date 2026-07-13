import { existsSync, lstatSync, readdirSync, readlinkSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { SPARKLE_PUBLIC_ED_KEY } from '../../src/shared/sparkle-signing.ts';
import { RELEASE_DIR } from './lib/config.ts';
import { exec, execOrNull } from './lib/exec.ts';
import { fail, info, step, warn } from './lib/log.ts';

if (process.platform !== 'darwin') {
  console.log('Not macOS — skipping verification.');
  process.exit(0);
}

const { values } = parseArgs({
  options: {
    'expected-team-id': { type: 'string' },
  },
  strict: true,
});

const expectedTeamId = values['expected-team-id'];

const appBundles = readdirSync(RELEASE_DIR)
  .filter((d) => d.startsWith('mac'))
  .flatMap((d) => {
    const dir = join(RELEASE_DIR, d);
    return readdirSync(dir)
      .filter((f) => f.endsWith('.app'))
      .map((f) => join(dir, f));
  })
  .filter((p) => existsSync(p));

if (appBundles.length === 0) {
  fail('No app bundles found to verify');
}

let verified = 0;

for (const appDir of appBundles) {
  const archDir = appDir.split('/').at(-2)!;
  const expectedArch =
    archDir === 'mac-arm64' ? 'arm64' : archDir.startsWith('mac') ? 'x86_64' : null;

  const productName = basename(appDir, '.app');

  step(`Verifying ${appDir} (expected: ${expectedArch ?? 'unknown'})`);

  const electronBin = join(appDir, 'Contents', 'MacOS', productName);
  const sparkleHelper = join(appDir, 'Contents', 'Helpers', 'YodaSparkleUpdater');
  const sparkleFramework = join(
    appDir,
    'Contents',
    'Frameworks',
    'Sparkle.framework',
    'Versions',
    'B',
    'Sparkle'
  );
  const sparkleFrameworkBundle = join(appDir, 'Contents', 'Frameworks', 'Sparkle.framework');
  const sqliteNode = join(
    appDir,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node'
  );

  if (expectedArch) {
    const binArch = execOrNull(`file "${electronBin}" | grep -o 'arm64\\|x86_64' | head -1`);
    info(`Electron binary: ${binArch}`);
    if (binArch !== expectedArch) {
      fail(`Electron arch mismatch: got ${binArch}, expected ${expectedArch}`);
    }

    if (existsSync(sqliteNode)) {
      const sqliteArch = execOrNull(`file "${sqliteNode}" | grep -o 'arm64\\|x86_64' | head -1`);
      info(`sqlite3 native module: ${sqliteArch}`);
      if (sqliteArch !== expectedArch) {
        fail(`sqlite3 arch mismatch: got ${sqliteArch}, expected ${expectedArch}`);
      }
    } else {
      warn(`sqlite3 native module not found at ${sqliteNode}`);
    }
  }

  if (!existsSync(sparkleHelper)) {
    fail(`Sparkle helper not found at ${sparkleHelper}`);
  }
  if (!existsSync(sparkleFramework)) {
    fail(`Sparkle framework not found at ${sparkleFramework}`);
  }

  for (const [relativePath, expectedTarget] of [
    ['Sparkle', 'Versions/Current/Sparkle'],
    [join('Versions', 'Current'), 'B'],
  ] as const) {
    const linkPath = join(sparkleFrameworkBundle, relativePath);
    if (
      !existsSync(linkPath) ||
      !lstatSync(linkPath).isSymbolicLink() ||
      readlinkSync(linkPath) !== expectedTarget
    ) {
      fail(`Sparkle framework has a non-portable link at ${relativePath}`);
    }
  }

  for (const [label, binary] of [
    ['Sparkle helper', sparkleHelper],
    ['Sparkle framework', sparkleFramework],
  ] as const) {
    const architectures = execOrNull(`lipo -archs "${binary}"`);
    info(`${label}: ${architectures ?? 'unknown architectures'}`);
    if (!architectures?.includes('arm64') || !architectures.includes('x86_64')) {
      fail(`${label} must contain both arm64 and x86_64`);
    }
    const permissions = statSync(binary).mode & 0o777;
    if (permissions !== 0o755) {
      fail(`${label} must have 0755 permissions for Sparkle delta eligibility`);
    }
  }

  const helperStrings = exec(`strings "${sparkleHelper}"`);
  if (!helperStrings.includes('yoda-full-update-disabled')) {
    fail('Sparkle helper is missing the delta-only full-download guard');
  }

  exec(`codesign --verify --strict --verbose=2 "${sparkleHelper}"`, { echo: true });
  exec(`codesign --verify --strict --verbose=2 "${sparkleFrameworkBundle}"`, { echo: true });

  const plist = join(appDir, 'Contents', 'Info.plist');
  if (existsSync(plist)) {
    const bid =
      execOrNull(`/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "${plist}"`) ??
      execOrNull(
        `plutil -extract CFBundleIdentifier xml1 -o - "${plist}" | sed -n 's/.*<string>\\(.*\\)<\\/string>.*/\\1/p' | head -n1`
      );
    info(`CFBundleIdentifier: ${bid}`);
    const sparklePublicKey = execOrNull(
      `/usr/libexec/PlistBuddy -c 'Print :SUPublicEDKey' "${plist}"`
    );
    if (sparklePublicKey !== SPARKLE_PUBLIC_ED_KEY) {
      fail('SUPublicEDKey is missing or does not match the release signing key');
    }
    const allowsLocalNetworking = execOrNull(
      `/usr/libexec/PlistBuddy -c 'Print :NSAppTransportSecurity:NSAllowsLocalNetworking' "${plist}"`
    );
    if (allowsLocalNetworking !== 'true') {
      fail('NSAllowsLocalNetworking must be enabled for the closed Sparkle proxy');
    }
  }

  exec(`codesign --verify --deep --strict --verbose=2 "${appDir}"`, { echo: true });

  if (expectedTeamId) {
    const meta = exec(`codesign -dv --verbose=4 "${appDir}" 2>&1`);
    if (!meta.includes('Authority=Developer ID Application')) {
      fail('Not Developer ID Application signed');
    }
    const tidMatch = meta.match(/TeamIdentifier=(\S+)/);
    const tid = tidMatch?.[1];
    if (tid !== expectedTeamId) {
      fail(`TeamIdentifier mismatch (got '${tid}', expected '${expectedTeamId}')`);
    }
    info(`TeamIdentifier: ${tid}`);
  }

  verified++;
}

info(`Verified ${verified} app bundle(s)`);
