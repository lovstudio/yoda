export type MacUpdateArch = 'arm64' | 'x64';

export type SparkleDelta = {
  fromVersion: string;
  toVersion: string;
  url: string;
  length: number;
  edSignature: string;
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
