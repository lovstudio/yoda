export type MacUpdateArch = 'arm64' | 'x64';

export type SparkleDelta = {
  fromVersion: string;
  toVersion: string;
  url: string;
  length: number;
  edSignature: string;
};

export type SparkleAppcastUpdate = {
  delta: SparkleDelta;
  releaseNotes?: string;
  releaseDate?: string;
};

export class SparkleDeltaRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SparkleDeltaRequiredError';
  }
}

export function sparkleFeedUrlForArch(baseUrl: string, arch: string): string {
  if (arch !== 'arm64' && arch !== 'x64') {
    throw new SparkleDeltaRequiredError(`Unsupported macOS update architecture: ${arch}`);
  }
  return `${baseUrl.trim().replace(/\/+$/, '')}/appcast-${arch}.xml`;
}

export function findRequiredSparkleDelta(content: string, currentVersion: string): SparkleDelta {
  const item = firstAppcastItem(content);
  const toVersion = elementText(item, 'sparkle:version');
  if (!toVersion) {
    throw new SparkleDeltaRequiredError('Appcast update has no sparkle:version');
  }

  const deltas = elementBody(item, 'sparkle:deltas');
  const enclosurePattern = /<enclosure\b([^>]*)\/?\s*>/gi;
  for (const match of deltas.matchAll(enclosurePattern)) {
    const attributes = parseAttributes(match[1]);
    if (attributes['sparkle:deltaFrom'] !== currentVersion) continue;

    const url = attributes.url;
    if (!url || !isDeltaUrl(url)) {
      throw new SparkleDeltaRequiredError(
        `Delta from ${currentVersion} to ${toVersion} has a non-delta URL`
      );
    }
    const edSignature = attributes['sparkle:edSignature'];
    if (!edSignature) {
      throw new SparkleDeltaRequiredError(
        `Delta from ${currentVersion} to ${toVersion} is unsigned`
      );
    }
    const length = Number(attributes.length);
    if (!Number.isSafeInteger(length) || length <= 0) {
      throw new SparkleDeltaRequiredError(
        `Delta from ${currentVersion} to ${toVersion} has an invalid length`
      );
    }

    return { fromVersion: currentVersion, toVersion, url, length, edSignature };
  }

  throw new SparkleDeltaRequiredError(`No signed delta from ${currentVersion} to ${toVersion}`);
}

export function findAvailableSparkleUpdate(
  content: string,
  currentVersion: string
): SparkleAppcastUpdate | null {
  const item = firstAppcastItem(content);
  const toVersion = elementText(item, 'sparkle:version');
  if (!toVersion) {
    throw new SparkleDeltaRequiredError('Appcast update has no sparkle:version');
  }
  if (compareReleaseVersions(toVersion, currentVersion) <= 0) return null;

  const description = elementText(item, 'description');
  const pubDate = elementText(item, 'pubDate');
  return {
    delta: findRequiredSparkleDelta(content, currentVersion),
    ...(description ? { releaseNotes: description } : {}),
    ...(pubDate ? { releaseDate: pubDate } : {}),
  };
}

export function compareReleaseVersions(left: string, right: string): number {
  const leftParts = parseReleaseVersion(left);
  const rightParts = parseReleaseVersion(right);
  if (!leftParts || !rightParts) {
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
  }

  const coreLength = Math.max(leftParts.core.length, rightParts.core.length);
  for (let index = 0; index < coreLength; index += 1) {
    const difference = (leftParts.core[index] ?? 0) - (rightParts.core[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }

  if (!leftParts.prerelease && !rightParts.prerelease) return 0;
  if (!leftParts.prerelease) return 1;
  if (!rightParts.prerelease) return -1;

  const prereleaseLength = Math.max(leftParts.prerelease.length, rightParts.prerelease.length);
  for (let index = 0; index < prereleaseLength; index += 1) {
    const leftIdentifier = leftParts.prerelease[index];
    const rightIdentifier = rightParts.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;

    const leftNumber = /^\d+$/.test(leftIdentifier) ? Number(leftIdentifier) : null;
    const rightNumber = /^\d+$/.test(rightIdentifier) ? Number(rightIdentifier) : null;
    if (leftNumber !== null && rightNumber !== null) return Math.sign(leftNumber - rightNumber);
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftIdentifier.localeCompare(rightIdentifier);
  }
  return 0;
}

function parseReleaseVersion(
  value: string
): { core: number[]; prerelease: string[] | null } | null {
  const normalized = value.trim().replace(/^v/i, '').split('+', 1)[0];
  const [coreValue, prereleaseValue] = normalized.split('-', 2);
  const coreSegments = coreValue.split('.');
  if (coreSegments.length === 0 || coreSegments.some((segment) => !/^\d+$/.test(segment))) {
    return null;
  }
  return {
    core: coreSegments.map(Number),
    prerelease: prereleaseValue ? prereleaseValue.split('.') : null,
  };
}

function firstAppcastItem(content: string): string {
  const match = /<item\b[^>]*>([\s\S]*?)<\/item>/i.exec(content);
  if (!match) throw new SparkleDeltaRequiredError('Appcast has no update item');
  return match[1];
}

function elementText(content: string, name: string): string {
  return decodeXml(elementBody(content, name).trim());
}

function elementBody(content: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<${escapedName}\\b[^>]*>([\\s\\S]*?)<\\/${escapedName}>`, 'i').exec(
    content
  );
  return match?.[1] ?? '';
}

function parseAttributes(content: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of content.matchAll(pattern)) {
    attributes[match[1]] = decodeXml(match[2] ?? match[3] ?? '');
  }
  return attributes;
}

function isDeltaUrl(value: string): boolean {
  try {
    return new URL(value).pathname.endsWith('.delta');
  } catch {
    return false;
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
