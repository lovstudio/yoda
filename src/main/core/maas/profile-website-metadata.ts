import type { MaasProfileWebsiteMetadata } from '@shared/maas';

const META_DESCRIPTION_KEYS = new Set(['description', 'og:description', 'twitter:description']);
const META_NAME_KEYS = new Set(['application-name', 'og:site_name']);
const META_LOGO_KEYS = new Set(['og:logo', 'twitter:image']);
const DESCRIPTION_LIMIT = 280;

type JsonLdRecord = Record<string, unknown>;

export function extractMaasProfileWebsiteMetadata(
  html: string,
  websiteUrl: string
): MaasProfileWebsiteMetadata {
  const jsonLd = extractJsonLdRecords(html);
  const name =
    firstJsonLdString(jsonLd, 'name') ??
    firstMetaContent(html, META_NAME_KEYS) ??
    extractTitle(html) ??
    null;
  const description =
    firstJsonLdString(jsonLd, 'description') ??
    firstMetaContent(html, META_DESCRIPTION_KEYS) ??
    null;
  const logoCandidate =
    firstJsonLdLogo(jsonLd) ?? firstMetaContent(html, META_LOGO_KEYS) ?? extractLinkedLogo(html);

  return {
    websiteUrl,
    name: cleanName(name),
    description: description ? trimText(description, DESCRIPTION_LIMIT) : null,
    logoUrl: resolveHttpUrl(logoCandidate, websiteUrl),
  };
}

function extractJsonLdRecords(html: string): JsonLdRecord[] {
  const records: JsonLdRecord[] = [];
  const scriptPattern =
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptPattern)) {
    const source = decodeHtmlEntities(match[1] ?? '').trim();
    if (!source) continue;
    try {
      collectJsonLdRecords(JSON.parse(source) as unknown, records);
    } catch {
      // A malformed JSON-LD block should not prevent ordinary meta extraction.
    }
  }
  return records;
}

function collectJsonLdRecords(value: unknown, records: JsonLdRecord[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectJsonLdRecords(item, records));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as JsonLdRecord;
  records.push(record);
  collectJsonLdRecords(record['@graph'], records);
}

function jsonLdScore(record: JsonLdRecord): number {
  const rawType = record['@type'];
  const types = (Array.isArray(rawType) ? rawType : [rawType])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.toLowerCase());
  if (types.some((value) => ['organization', 'brand', 'softwareapplication'].includes(value))) {
    return 3;
  }
  if (types.includes('website')) return 2;
  return 0;
}

function firstJsonLdString(records: JsonLdRecord[], key: string): string | null {
  const ordered = [...records].sort((left, right) => jsonLdScore(right) - jsonLdScore(left));
  for (const record of ordered) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return normalizeText(value);
  }
  return null;
}

function firstJsonLdLogo(records: JsonLdRecord[]): string | null {
  const ordered = [...records].sort((left, right) => jsonLdScore(right) - jsonLdScore(left));
  for (const record of ordered) {
    const value = record.logo;
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object') {
      const url = (value as JsonLdRecord).url ?? (value as JsonLdRecord).contentUrl;
      if (typeof url === 'string' && url.trim()) return url.trim();
    }
  }
  return null;
}

function firstMetaContent(html: string, keys: ReadonlySet<string>): string | null {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(tag[0]);
    const key = (
      attributes.get('name') ??
      attributes.get('property') ??
      attributes.get('itemprop') ??
      ''
    ).toLowerCase();
    if (!keys.has(key)) continue;
    const content = attributes.get('content');
    if (content?.trim()) return normalizeText(content);
  }
  return null;
}

function extractLinkedLogo(html: string): string | null {
  const candidates: Array<{ score: number; href: string }> = [];
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = parseAttributes(tag[0]);
    const rel = (attributes.get('rel') ?? '').toLowerCase();
    const href = attributes.get('href');
    if (!href?.trim()) continue;
    if (rel.includes('apple-touch-icon')) candidates.push({ score: 2, href });
    else if (rel.split(/\s+/).includes('icon')) candidates.push({ score: 1, href });
  }
  return candidates.sort((left, right) => right.score - left.score)[0]?.href ?? null;
}

function extractTitle(html: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match?.[1] ? normalizeText(decodeHtmlEntities(match[1])) : null;
}

function cleanName(value: string | null): string | null {
  if (!value) return null;
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const firstSegment = normalized.split(/\s+[|—–·]\s+|\s+-\s+/)[0]?.trim();
  return firstSegment || normalized;
}

function resolveHttpUrl(value: string | null, baseUrl: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function parseAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([^\s=<>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    const key = match[1]?.toLowerCase();
    if (!key) continue;
    attributes.set(key, decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? ''));
  }
  return attributes;
}

function trimText(value: string, limit: number): string {
  const normalized = normalizeText(value);
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 3).trim()}...`;
}

function normalizeText(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, raw: string) => {
    const key = raw.toLowerCase();
    if (key.startsWith('#x')) {
      const point = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
    }
    if (key.startsWith('#')) {
      const point = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
    }
    return named[key] ?? entity;
  });
}
