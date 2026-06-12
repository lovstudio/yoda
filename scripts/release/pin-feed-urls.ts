// Rewrites update manifest (v1-stable*.yml) file URLs from bare filenames to
// absolute versioned GitHub release URLs.
//
// Why: the stable feed base is `releases/latest/download` (versionless).
// electron-updater derives the OLD blockmap URL for differential downloads by
// replacing the new version string with the old one inside the file URL — with
// no version in the URL the "old" blockmap resolves to the new one and the
// differential path never works, so every update falls back to a full download.
// Versioned absolute URLs make both old and new blockmaps resolvable.
import { readFileSync, writeFileSync } from 'node:fs';
import { findManifests } from './lib/artifacts.ts';
import { fail, info, step } from './lib/log.ts';

const repo = process.env.GITHUB_REPOSITORY || 'lovstudio/yoda';
const manifests = findManifests();

if (manifests.length === 0) {
  fail('No update manifests found in release/');
}

for (const manifest of manifests) {
  step(`Pinning versioned URLs in ${manifest}`);
  const content = readFileSync(manifest, 'utf8');

  const versionMatch = content.match(/^version:\s*(\S+)/m);
  if (!versionMatch) {
    fail(`No version field in ${manifest}`);
  }
  const base = `https://github.com/${repo}/releases/download/v${versionMatch[1]}/`;

  const rewritten = content.replace(
    /^(\s*(?:- )?(?:url|path):\s*)(?!https?:\/\/)(\S+)$/gm,
    `$1${base}$2`
  );

  if (rewritten === content) {
    info(`No bare URLs to rewrite in ${manifest}`);
    continue;
  }

  writeFileSync(manifest, rewritten);
  info(`Pinned URLs to ${base}`);
}
