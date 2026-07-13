import { randomUUID } from 'node:crypto';
import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { executeAppBuilder, serializeToYaml } from 'builder-util';
import { parse } from 'yaml';

type UpdateFile = {
  url: string;
  sha512: string;
  size?: number;
  [key: string]: unknown;
};

type UpdateManifest = {
  files: UpdateFile[];
  path: string;
  sha512: string;
  [key: string]: unknown;
};

export type ArtifactMetadata = {
  sha512: string;
  size: number;
};

export type BlockmapGenerator = (
  inputPath: string,
  outputPath: string
) => Promise<ArtifactMetadata>;

export type RefreshMacUpdateMetadataOptions = {
  releaseDir: string;
  generateBlockmap?: BlockmapGenerator;
};

type PreparedBlockmap = {
  artifactName: string;
  finalPath: string;
  temporaryPath: string;
  metadata: ArtifactMetadata;
};

export async function refreshMacUpdateMetadata({
  releaseDir,
  generateBlockmap = generateBlockmapWithAppBuilder,
}: RefreshMacUpdateMetadataOptions): Promise<{ manifestPath: string; artifacts: string[] }> {
  const names = readdirSync(releaseDir).sort();
  const manifestNames = names.filter((name) => /^v1-.*-mac\.yml$/.test(name));
  if (manifestNames.length !== 1) {
    throw new Error(
      `Expected exactly one macOS update manifest in ${releaseDir}, found ${manifestNames.length}.`
    );
  }

  const dmgNames = names.filter((name) => name.endsWith('.dmg'));
  if (dmgNames.length === 0) {
    throw new Error(`No DMG artifacts found in ${releaseDir}.`);
  }

  const manifestPath = join(releaseDir, manifestNames[0]);
  const originalManifest = readFileSync(manifestPath, 'utf8');
  const manifest = parseManifest(originalManifest, manifestPath);
  const filesByName = indexManifestFiles(manifest);

  for (const fileName of filesByName.keys()) {
    if (!existsSync(join(releaseDir, fileName))) {
      throw new Error(`Manifest references missing release artifact: ${fileName}`);
    }
  }
  for (const dmgName of dmgNames) {
    if (!filesByName.has(dmgName)) {
      throw new Error(`DMG is missing from ${basename(manifestPath)}: ${dmgName}`);
    }
  }

  const prepared: PreparedBlockmap[] = [];
  const manifestTempPath = temporaryPathFor(manifestPath);
  const temporaryBlockmapPaths: string[] = [];

  try {
    for (const dmgName of dmgNames) {
      const dmgPath = join(releaseDir, dmgName);
      const finalPath = `${dmgPath}.blockmap`;
      const temporaryPath = temporaryPathFor(finalPath);
      temporaryBlockmapPaths.push(temporaryPath);
      const metadata = await generateBlockmap(dmgPath, temporaryPath);
      validateGeneratedMetadata(dmgPath, temporaryPath, metadata);
      prepared.push({ artifactName: dmgName, finalPath, temporaryPath, metadata });
    }

    const metadataByArtifact = new Map(
      prepared.map(({ artifactName, metadata }) => [artifactName, metadata])
    );
    const updatedManifest = updateMacManifest(originalManifest, metadataByArtifact, manifestPath);
    writeFileSync(manifestTempPath, updatedManifest, { flag: 'wx' });

    for (const blockmap of prepared) {
      renameSync(blockmap.temporaryPath, blockmap.finalPath);
    }
    renameSync(manifestTempPath, manifestPath);
  } catch (error) {
    rmSync(manifestTempPath, { force: true });
    for (const temporaryPath of temporaryBlockmapPaths) {
      rmSync(temporaryPath, { force: true });
    }
    throw error;
  }

  return { manifestPath, artifacts: dmgNames };
}

export function updateMacManifest(
  content: string,
  metadataByArtifact: ReadonlyMap<string, ArtifactMetadata>,
  manifestPath = 'macOS update manifest'
): string {
  const manifest = parseManifest(content, manifestPath);
  const filesByName = indexManifestFiles(manifest);

  for (const [artifactName, metadata] of metadataByArtifact) {
    if (!artifactName.endsWith('.dmg')) {
      throw new Error(`Expected a DMG artifact, received: ${artifactName}`);
    }
    validateMetadata(artifactName, metadata);
    const file = filesByName.get(artifactName);
    if (!file) {
      throw new Error(`DMG is missing from ${basename(manifestPath)}: ${artifactName}`);
    }
    file.sha512 = metadata.sha512;
    file.size = metadata.size;
  }

  const primaryName = artifactNameFromUrl(manifest.path);
  const primary = filesByName.get(primaryName);
  if (!primary) {
    throw new Error(`Manifest path does not match a files entry: ${manifest.path}`);
  }
  manifest.sha512 = primary.sha512;

  return serializeToYaml(manifest, false, true);
}

export async function generateBlockmapWithAppBuilder(
  inputPath: string,
  outputPath: string
): Promise<ArtifactMetadata> {
  const raw = await executeAppBuilder(['blockmap', '--input', inputPath, '--output', outputPath]);
  return JSON.parse(raw) as ArtifactMetadata;
}

function parseManifest(content: string, manifestPath: string): UpdateManifest {
  let value: unknown;
  try {
    value = parse(content);
  } catch {
    throw new Error(`Invalid YAML in ${manifestPath}.`);
  }

  if (!isRecord(value) || !Array.isArray(value.files) || value.files.length === 0) {
    throw new Error(`Manifest has no files entries: ${manifestPath}`);
  }
  if (typeof value.path !== 'string' || !value.path) {
    throw new Error(`Manifest has no path: ${manifestPath}`);
  }
  if (typeof value.sha512 !== 'string' || !value.sha512) {
    throw new Error(`Manifest has no sha512: ${manifestPath}`);
  }

  for (const file of value.files) {
    if (
      !isRecord(file) ||
      typeof file.url !== 'string' ||
      !file.url ||
      typeof file.sha512 !== 'string' ||
      !file.sha512
    ) {
      throw new Error(`Manifest contains an invalid files entry: ${manifestPath}`);
    }
  }

  return value as UpdateManifest;
}

function indexManifestFiles(manifest: UpdateManifest): Map<string, UpdateFile> {
  const filesByName = new Map<string, UpdateFile>();
  for (const file of manifest.files) {
    const name = artifactNameFromUrl(file.url);
    if (filesByName.has(name)) {
      throw new Error(`Manifest contains duplicate artifact basename: ${name}`);
    }
    filesByName.set(name, file);
  }
  return filesByName;
}

function artifactNameFromUrl(value: string): string {
  let name: string;
  try {
    const pathname = new URL(value, 'https://release.invalid/').pathname;
    name = basename(decodeURIComponent(pathname));
  } catch {
    throw new Error(`Invalid release artifact URL: ${value}`);
  }
  if (!name || name === '.' || name === '/') {
    throw new Error(`Release artifact URL has no filename: ${value}`);
  }
  return name;
}

function validateGeneratedMetadata(
  artifactPath: string,
  blockmapPath: string,
  metadata: ArtifactMetadata
): void {
  validateMetadata(basename(artifactPath), metadata);
  if (!existsSync(blockmapPath) || statSync(blockmapPath).size === 0) {
    throw new Error(`Blockmap generator did not create a non-empty file for ${artifactPath}.`);
  }
  const actualSize = statSync(artifactPath).size;
  if (metadata.size !== actualSize) {
    throw new Error(
      `Blockmap metadata size mismatch for ${artifactPath}: expected ${actualSize}, got ${metadata.size}.`
    );
  }
}

function validateMetadata(artifactName: string, metadata: ArtifactMetadata): void {
  if (!Number.isSafeInteger(metadata.size) || metadata.size <= 0) {
    throw new Error(`Invalid artifact size for ${artifactName}: ${metadata.size}`);
  }
  if (typeof metadata.sha512 !== 'string' || metadata.sha512.length === 0) {
    throw new Error(`Invalid artifact sha512 for ${artifactName}.`);
  }
}

function temporaryPathFor(path: string): string {
  return `${path}.refresh-${process.pid}-${randomUUID()}.tmp`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
