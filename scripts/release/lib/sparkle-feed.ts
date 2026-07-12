import { basename } from 'node:path';

export type SparkleArchiveHistoryItem = {
  version: string;
  url: string;
  fileName: string;
};

export function sparkleHistoryFallbackUrl(
  repository: string,
  item: SparkleArchiveHistoryItem
): string {
  return `https://github.com/${repository}/releases/download/v${item.version}/${encodeURIComponent(item.fileName)}`;
}

export function qualifySparkleDeltaArtifacts(
  content: string,
  arch: string,
  deltaFileNames: string[]
): { content: string; artifacts: Array<{ source: string; published: string }> } {
  let qualifiedContent = content;
  const artifacts = deltaFileNames.map((source) => {
    const published = source.replace(/\.delta$/, `-${arch}.delta`);
    if (published === source || !qualifiedContent.includes(source)) {
      throw new Error(`Sparkle appcast does not reference generated delta: ${source}`);
    }
    qualifiedContent = qualifiedContent.split(source).join(published);
    return { source, published };
  });
  return { content: qualifiedContent, artifacts };
}

export function removeSparkleDeltaEligibilityHints(content: string): string {
  return content.replace(
    /\s+sparkle:deltaFromSparkle(?:ExecutableSize|Locales)=(?:"[^"]*"|'[^']*')/gi,
    ''
  );
}

export function parseSparkleArchiveHistory(content: string): SparkleArchiveHistoryItem[] {
  const history: SparkleArchiveHistoryItem[] = [];
  for (const itemMatch of content.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const item = itemMatch[1];
    const version = elementText(item, 'sparkle:version');
    if (!version) continue;

    const withoutDeltas = item.replace(/<sparkle:deltas\b[^>]*>[\s\S]*?<\/sparkle:deltas>/gi, '');
    const enclosureMatch = /<enclosure\b([^>]*)\/?\s*>/i.exec(withoutDeltas);
    if (!enclosureMatch) continue;
    const attributes = parseAttributes(enclosureMatch[1]);
    const url = attributes.url;
    if (!url) continue;

    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !parsed.pathname.endsWith('.zip')) {
      throw new Error(`Sparkle full archive must be an HTTPS ZIP: ${url}`);
    }
    history.push({ version, url, fileName: basename(parsed.pathname) });
  }
  return history;
}

export function validateGeneratedSparkleAppcast(
  content: string,
  currentVersion: string,
  expectedDeltaFromVersions: string[]
): void {
  const [latest] = parseSparkleArchiveHistory(content);
  if (!latest || latest.version !== currentVersion) {
    throw new Error(
      `Generated appcast latest version is ${latest?.version ?? 'missing'}, expected ${currentVersion}`
    );
  }

  const firstItem = /<item\b[^>]*>([\s\S]*?)<\/item>/i.exec(content)?.[1] ?? '';
  const withoutDeltas = firstItem.replace(
    /<sparkle:deltas\b[^>]*>[\s\S]*?<\/sparkle:deltas>/gi,
    ''
  );
  const enclosureMatch = /<enclosure\b([^>]*)\/?\s*>/i.exec(withoutDeltas);
  const fullAttributes = enclosureMatch ? parseAttributes(enclosureMatch[1]) : {};
  if (!fullAttributes['sparkle:edSignature']) {
    throw new Error('Generated Sparkle full archive is unsigned');
  }

  for (const fromVersion of expectedDeltaFromVersions) {
    assertSignedDelta(content, currentVersion, fromVersion);
  }
}

function assertSignedDelta(content: string, toVersion: string, fromVersion: string): void {
  const firstItem = /<item\b[^>]*>([\s\S]*?)<\/item>/i.exec(content)?.[1] ?? '';
  const deltas = /<sparkle:deltas\b[^>]*>([\s\S]*?)<\/sparkle:deltas>/i.exec(firstItem)?.[1] ?? '';
  for (const match of deltas.matchAll(/<enclosure\b([^>]*)\/?\s*>/gi)) {
    const attributes = parseAttributes(match[1]);
    if (attributes['sparkle:deltaFrom'] !== fromVersion) continue;
    const url = attributes.url;
    if (
      url &&
      new URL(url).pathname.endsWith('.delta') &&
      attributes['sparkle:edSignature'] &&
      Number(attributes.length) > 0
    ) {
      return;
    }
  }
  throw new Error(`No signed delta from ${fromVersion} to ${toVersion}`);
}

function elementText(content: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<${escapedName}\\b[^>]*>([\\s\\S]*?)<\\/${escapedName}>`, 'i').exec(
    content
  );
  return decodeXml((match?.[1] ?? '').trim());
}

function parseAttributes(content: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of content.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[match[1]] = decodeXml(match[2] ?? match[3] ?? '');
  }
  return attributes;
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
