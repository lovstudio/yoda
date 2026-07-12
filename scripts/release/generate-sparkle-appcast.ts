import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { R2_BASE_URL } from '../../src/shared/app-identity.ts';
import { fail, info, step } from './lib/log.ts';
import {
  parseSparkleArchiveHistory,
  qualifySparkleDeltaArtifacts,
  validateGeneratedSparkleAppcast,
  type SparkleArchiveHistoryItem,
} from './lib/sparkle-feed.ts';

const { values } = parseArgs({
  options: {
    variant: { type: 'string' },
  },
  strict: true,
});

if (process.platform !== 'darwin') {
  fail('Sparkle appcasts can only be generated on macOS');
}
if (values.variant !== 'stable' && values.variant !== 'canary') {
  fail('Usage: generate-sparkle-appcast.ts --variant stable|canary');
}

const variant = values.variant;
const artifactPrefix = variant === 'canary' ? 'yoda-canary' : 'yoda';
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { version?: string };
const currentVersion = packageJson.version ?? fail('package.json has no version');

const privateKey = process.env.SPARKLE_ED_PRIVATE_KEY?.trim();
if (!privateKey) fail('SPARKLE_ED_PRIVATE_KEY is required to publish macOS updates');

const repository = process.env.GITHUB_REPOSITORY || 'lovstudio/yoda';
const existingFeedBase =
  variant === 'canary' ? R2_BASE_URL : `https://github.com/${repository}/releases/latest/download`;
const generateAppcast = resolve('build/sparkle/bin/generate_appcast');
if (!existsSync(generateAppcast)) {
  fail('Sparkle generate_appcast is missing; run pnpm run prepare:sparkle first');
}

const arches = ['arm64', 'x64'].filter((arch) =>
  existsSync(join('release', `${artifactPrefix}-${arch}.zip`))
);
if (arches.length === 0) {
  fail(`No ${artifactPrefix}-<arch>.zip artifacts found in release/`);
}

for (const arch of arches) {
  await generateForArch(arch);
}

async function generateForArch(arch: string): Promise<void> {
  step(`Generating signed Sparkle appcast for ${variant} ${arch}`);
  const sourceArchive = join('release', `${artifactPrefix}-${arch}.zip`);
  const versionedArchiveName = `${artifactPrefix}-${currentVersion}-${arch}.zip`;
  const workDir = resolve('.cache', 'sparkle-appcast', variant, arch);
  const appcastName = `appcast-${arch}.xml`;
  const appcastPath = join(workDir, appcastName);

  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  copyFileSync(sourceArchive, join(workDir, versionedArchiveName));
  writeReleaseNotes(join(workDir, replaceExtension(versionedArchiveName, '.md')));

  const existingAppcast = await fetchOptionalText(`${existingFeedBase}/${appcastName}`);
  const history = existingAppcast
    ? uniqueHistory(parseSparkleArchiveHistory(existingAppcast))
        .filter((item) => item.version !== currentVersion)
        .slice(0, 5)
    : [];

  if (existingAppcast) writeFileSync(appcastPath, existingAppcast);
  for (const item of history) {
    await downloadArchive(item, join(workDir, item.fileName));
  }

  runGenerateAppcast(workDir, appcastPath);
  const deltaFileNames = readdirSync(workDir).filter((name) => name.endsWith('.delta'));
  const qualified = qualifySparkleDeltaArtifacts(
    readFileSync(appcastPath, 'utf8'),
    arch,
    deltaFileNames
  );
  const generated = qualified.content;
  writeFileSync(appcastPath, generated);
  validateGeneratedSparkleAppcast(
    generated,
    currentVersion,
    history.map((item) => item.version)
  );

  copyFileSync(appcastPath, join('release', appcastName));
  copyFileSync(join(workDir, versionedArchiveName), join('release', versionedArchiveName));
  for (const delta of qualified.artifacts) {
    const source = join(workDir, delta.source);
    if (statSync(source).size <= 0) fail(`Generated empty Sparkle delta: ${delta.source}`);
    copyFileSync(source, join('release', delta.published));
  }

  if (history.length > 0 && qualified.artifacts.length === 0) {
    fail(`Sparkle generated no ${arch} deltas from existing release history`);
  }
  info(
    `Generated ${appcastName}, ${versionedArchiveName}, and ${qualified.artifacts.length} delta(s)`
  );
}

function runGenerateAppcast(workDir: string, outputPath: string): void {
  const result = spawnSync(
    generateAppcast,
    [
      '--ed-key-file',
      '-',
      '--disable-signing-warning',
      '--download-url-prefix',
      `${R2_BASE_URL}/`,
      '--embed-release-notes',
      '--maximum-versions',
      '6',
      '--maximum-deltas',
      '5',
      '-o',
      outputPath,
      workDir,
    ],
    {
      encoding: 'utf8',
      input: `${privateKey}\n`,
      maxBuffer: 32 * 1024 * 1024,
    }
  );
  if (result.status !== 0) {
    const details = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim().slice(-12_000);
    fail(`generate_appcast failed (${result.status ?? result.signal ?? 'unknown'}): ${details}`);
  }
}

async function fetchOptionalText(url: string): Promise<string | null> {
  const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
  if (response.status === 404) {
    info(`No existing Sparkle feed at ${url}; creating bootstrap feed`);
    return null;
  }
  if (!response.ok) fail(`Failed to fetch existing Sparkle feed: HTTP ${response.status}`);
  return await response.text();
}

async function downloadArchive(
  item: SparkleArchiveHistoryItem,
  destination: string
): Promise<void> {
  if (existsSync(destination)) return;
  info(`Downloading Sparkle history ${item.version}: ${item.url}`);
  const response = await fetch(item.url, { headers: { 'Cache-Control': 'no-cache' } });
  if (!response.ok) {
    fail(`Failed to download Sparkle history ${item.version}: HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    fail(`Sparkle history ${item.version} is not a ZIP archive`);
  }
  writeFileSync(destination, bytes);
}

function uniqueHistory(history: SparkleArchiveHistoryItem[]): SparkleArchiveHistoryItem[] {
  const seen = new Set<string>();
  return history.filter((item) => {
    if (seen.has(item.version)) return false;
    seen.add(item.version);
    return true;
  });
}

function writeReleaseNotes(path: string): void {
  const changelog = existsSync('CHANGELOG.md') ? readFileSync('CHANGELOG.md', 'utf8') : '';
  const escapedVersion = currentVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const section = new RegExp(
    `^##\\s+${escapedVersion}[^\\n]*\\n([\\s\\S]*?)(?=^##\\s+|$)`,
    'm'
  ).exec(changelog)?.[1];
  writeFileSync(path, section?.trim() || `Yoda ${currentVersion}`);
}

function replaceExtension(fileName: string, extension: string): string {
  return `${basename(fileName, extname(fileName))}${extension}`;
}
