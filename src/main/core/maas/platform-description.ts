import {
  type MaasPlatformDefinition,
  type MaasPlatformInfoSnapshot,
  type MaasPlatformOfficialDescription,
} from '@shared/maas';

export const MAAS_PLATFORM_INFO_SNAPSHOT_VERSION = 1;

const META_DESCRIPTION_KEYS = new Set(['description', 'og:description', 'twitter:description']);
const BODY_EXCERPT_LIMIT = 4_000;
const DESCRIPTION_LIMIT = 220;

type ExtractDescriptionInput = {
  platform: MaasPlatformDefinition;
  sourceUrl: string;
  html: string;
  fetchedAt?: string;
};

export function extractMaasPlatformDescription({
  platform,
  sourceUrl,
  html,
  fetchedAt = new Date().toISOString(),
}: ExtractDescriptionInput): MaasPlatformOfficialDescription {
  return toMaasPlatformOfficialDescription(
    extractMaasPlatformInfoSnapshot({ platform, sourceUrl, html, fetchedAt })
  );
}

export function extractMaasPlatformInfoSnapshot({
  platform,
  sourceUrl,
  html,
  fetchedAt = new Date().toISOString(),
}: ExtractDescriptionInput): MaasPlatformInfoSnapshot {
  const bodyText = extractBodyText(html);
  const metaDescription = pickBestMetaDescription(platform, html);
  if (metaDescription) {
    return {
      version: MAAS_PLATFORM_INFO_SNAPSHOT_VERSION,
      platformId: platform.id,
      description: trimDescription(metaDescription),
      source: 'official-meta',
      sourceUrl,
      fetchedAt,
      metaDescription,
      bodySummary: null,
      bodyTextExcerpt: null,
      bodyText,
      bodyCharCount: bodyText.length,
      error: null,
    };
  }

  const bodySummary = summarizeBodyDescription(platform, bodyText);
  if (bodySummary) {
    return {
      version: MAAS_PLATFORM_INFO_SNAPSHOT_VERSION,
      platformId: platform.id,
      description: trimDescription(bodySummary),
      source: 'official-body-summary',
      sourceUrl,
      fetchedAt,
      metaDescription: null,
      bodySummary: trimDescription(bodySummary),
      bodyTextExcerpt: bodyText.slice(0, BODY_EXCERPT_LIMIT),
      bodyText,
      bodyCharCount: bodyText.length,
      error: null,
    };
  }

  return fallbackMaasPlatformInfoSnapshot(platform, sourceUrl, 'No usable page description found.');
}

export function fallbackMaasPlatformDescription(
  platform: MaasPlatformDefinition,
  sourceUrl: string | null,
  error: string | null = null
): MaasPlatformOfficialDescription {
  return toMaasPlatformOfficialDescription(
    fallbackMaasPlatformInfoSnapshot(platform, sourceUrl, error)
  );
}

export function fallbackMaasPlatformInfoSnapshot(
  platform: MaasPlatformDefinition,
  sourceUrl: string | null,
  error: string | null = null
): MaasPlatformInfoSnapshot {
  return {
    version: MAAS_PLATFORM_INFO_SNAPSHOT_VERSION,
    platformId: platform.id,
    description: platform.description,
    source: 'fallback',
    sourceUrl,
    fetchedAt: error ? new Date().toISOString() : null,
    metaDescription: null,
    bodySummary: null,
    bodyTextExcerpt: null,
    bodyText: null,
    bodyCharCount: null,
    error,
  };
}

export function toMaasPlatformOfficialDescription(
  snapshot: MaasPlatformInfoSnapshot
): MaasPlatformOfficialDescription {
  return {
    platformId: snapshot.platformId,
    description: snapshot.description,
    source: snapshot.source,
    sourceUrl: snapshot.sourceUrl,
    fetchedAt: snapshot.fetchedAt,
    metaDescription: snapshot.metaDescription,
    bodySummary: snapshot.bodySummary,
    bodyTextExcerpt: snapshot.bodyTextExcerpt,
    bodyCharCount: snapshot.bodyCharCount,
    error: snapshot.error,
  };
}

function pickBestMetaDescription(platform: MaasPlatformDefinition, html: string): string | null {
  const candidates = extractMetaDescriptions(html);
  const usable = candidates
    .map((candidate) => normalizeText(candidate))
    .filter((candidate) => isUsableDescription(platform, candidate));

  if (usable.length === 0) return null;
  return usable.sort(
    (left, right) => scoreDescription(platform, right) - scoreDescription(platform, left)
  )[0]!;
}

function extractMetaDescriptions(html: string): string[] {
  const descriptions: string[] = [];
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(tag[0]);
    const key = (
      attributes.get('name') ??
      attributes.get('property') ??
      attributes.get('itemprop') ??
      ''
    ).toLowerCase();
    if (!META_DESCRIPTION_KEYS.has(key)) continue;

    const content = attributes.get('content');
    if (content?.trim()) descriptions.push(content);
  }
  return descriptions;
}

function parseAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const attrPattern = /([^\s=<>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

  for (const match of tag.matchAll(attrPattern)) {
    const key = match[1]?.toLowerCase();
    if (!key) continue;
    attributes.set(key, decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? ''));
  }
  return attributes;
}

function extractBodyText(html: string): string {
  const bodyHtml = matchTagContent(html, 'main') ?? matchTagContent(html, 'article') ?? html;
  const withoutNoise = bodyHtml
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<header\b[\s\S]*?<\/header>/gi, ' ')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ');

  return normalizeText(
    decodeHtmlEntities(
      withoutNoise
        .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, '. ')
        .replace(/<br\s*\/?>/gi, '. ')
        .replace(/<[^>]+>/g, ' ')
    )
  );
}

function matchTagContent(html: string, tagName: string): string | null {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  return pattern.exec(html)?.[1] ?? null;
}

function summarizeBodyDescription(
  platform: MaasPlatformDefinition,
  bodyText: string
): string | null {
  if (!bodyText) return null;

  const sentences = splitSentences(bodyText)
    .map((sentence) => normalizeText(sentence.replace(/^[.\s]+/, '')))
    .filter((sentence) => sentence.length >= 24)
    .filter((sentence) => !isNavigationText(sentence));

  const usable = sentences.filter((sentence) => isUsableDescription(platform, sentence));
  const candidates = usable.length > 0 ? usable : sentences;
  const best = candidates
    .slice(0, 40)
    .sort((left, right) => scoreDescription(platform, right) - scoreDescription(platform, left))[0];

  if (best) return best;
  return bodyText.length >= 24 ? bodyText : null;
}

function splitSentences(text: string): string[] {
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]?/g) ?? [];
  if (sentences.length > 0) return sentences;
  return text.split(/\s{2,}/);
}

function isUsableDescription(platform: MaasPlatformDefinition, text: string): boolean {
  const normalized = normalizeText(text);
  if (normalized.length < 24) return false;
  if (/^(404|not found|just a moment|enable javascript|please wait)\b/i.test(normalized)) {
    return false;
  }
  return scoreDescription(platform, normalized) >= 4;
}

function scoreDescription(platform: MaasPlatformDefinition, text: string): number {
  const normalized = text.toLowerCase();
  const platformName = platform.name.toLowerCase();
  const platformId = platform.id.toLowerCase();
  const nameWords = platformName.split(/\s+/).filter((word) => word.length > 2);
  let score = 0;

  if (normalized.includes(platformName) || normalized.includes(platformId)) score += 4;
  if (nameWords.some((word) => normalized.includes(word))) score += 2;
  if (/\b(api|model|models|provider|providers|routing|router|openai|llm|ai|genai)\b/i.test(text)) {
    score += 2;
  }
  if (/\b(docs?|documentation|quickstart|guide|reference)\b/i.test(text)) score -= 1;
  if (isNavigationText(text)) score -= 4;

  return score;
}

function isNavigationText(text: string): boolean {
  return /^(home|docs?|documentation|pricing|blog|login|sign in|sign up|contact|dashboard)\b/i.test(
    text
  );
}

function trimDescription(text: string): string {
  const normalized = normalizeText(text);
  if (normalized.length <= DESCRIPTION_LIMIT) return normalized;

  const sentenceBoundary = normalized
    .slice(0, DESCRIPTION_LIMIT)
    .search(/[.!?。！？][^.!?。！？]*$/);
  if (sentenceBoundary >= 80) return normalized.slice(0, sentenceBoundary + 1).trim();
  return `${normalized.slice(0, DESCRIPTION_LIMIT - 3).trim()}...`;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value: string): string {
  const namedEntities: Record<string, string> = {
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
      const codePoint = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    if (key.startsWith('#')) {
      const codePoint = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return namedEntities[key] ?? entity;
  });
}
