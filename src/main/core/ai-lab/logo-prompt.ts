import type { LogoStyleId } from '@shared/ai-lab';

const STYLE_FRAGMENTS: Record<LogoStyleId, string> = {
  minimal: 'minimalist flat vector mark, clean lines, generous negative space, at most two colors',
  geometric:
    'geometric mark built from precise primitive shapes, balanced symmetry, flat solid colors',
  wordmark: 'typographic wordmark: custom lettering of the brand name itself, no pictorial symbol',
  badge: 'badge or emblem style logo, circular or shield composition, bold contained silhouette',
  mascot:
    'friendly mascot character logo, simple rounded shapes, bold outlines, expressive but clean',
  gradient:
    'modern mark with smooth vibrant gradients, soft dimensional feel, contemporary tech aesthetic',
};

/**
 * One prompt builder shared by every engine, so switching engines never
 * changes the brief — only the renderer behind it.
 */
export function buildLogoPrompt(input: {
  brandName: string;
  description: string;
  styleId: LogoStyleId;
}): string {
  const description = input.description.trim();
  return [
    `Design a professional logo for the brand "${input.brandName}".`,
    description ? `About the brand: ${description}` : null,
    `Style: ${STYLE_FRAGMENTS[input.styleId]}.`,
    'Requirements: square 1:1 composition, logo centered on a plain solid light background,',
    'crisp vector-like rendering, no photographic elements, no watermark, no mockup scene,',
    input.styleId === 'wordmark'
      ? `the brand name "${input.brandName}" is the logo itself — spell it exactly and legibly.`
      : 'no extra text besides (optionally) the brand name.',
  ]
    .filter(Boolean)
    .join('\n');
}
