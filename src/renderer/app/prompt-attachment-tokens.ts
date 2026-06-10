/**
 * Inline attachment tokens for the home composer.
 *
 * Attachments live inside the prompt text as sentinel tokens — a label such
 * as `图 1` or `report.pdf` wrapped in en-space (U+2002) delimiter pairs —
 * plain text to the textarea (normal line height, caret ordering, undo),
 * mapped to absolute paths via a session-local registry.
 * Deliberately no `@` prefix: that's the user's path-mention trigger and must
 * not fire when the caret touches a token. Tokens are atomic — the selection
 * snaps to token boundaries and Backspace/Delete removes a whole token. On
 * submit the sentinels are replaced with what the agent actually receives:
 * `@path` mentions, or `{{yoda-image:N}}` markers that the main process turns
 * into native clipboard pastes at exactly that position.
 */

export type PromptTokenKind = 'image' | 'file';

export type PromptToken = {
  id: string;
  kind: PromptTokenKind;
  /** Unique display label; the composer text is the label wrapped in en-space delimiters. */
  label: string;
  /** Absolute local path of the attachment. */
  path: string;
  /** Object URL for image hover previews; revoked when the token is dropped. */
  previewUrl?: string;
};

export type TokenRange = { token: PromptToken; start: number; end: number };

/** Rect relative to the textarea's border box (scroll not subtracted). */
export type TokenRect = { left: number; top: number; width: number; height: number };

// Sentinel delimiter: three en spaces (U+2002) on each side. They have width
// but NO ink, so they both reserve the horizontal room the chip overlay needs
// (icon + padding) and let the chip inset a few px for breathing room without
// any glyph edge peeking out from underneath. Users can't type them, so the
// syntax never collides with hand-written text.
const TOKEN_DELIM = '\u2002\u2002\u2002';
const TOKEN_RE = /\u2002{3}([^\u2002\n]{1,126})\u2002{3}/g;

export function tokenText(label: string): string {
  return `${TOKEN_DELIM}${label}${TOKEN_DELIM}`;
}

/** Strip characters that would break the sentinel syntax. */
export function sanitizeTokenLabel(raw: string): string {
  const cleaned = raw
    .replace(/[\u2002\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
  return cleaned || 'attachment';
}

/** Compact display label for a file: long basenames are middle-truncated so
 *  the inline token stays short, keeping the extension visible. */
export function fileTokenLabel(name: string): string {
  const sanitized = sanitizeTokenLabel(name);
  const dot = sanitized.lastIndexOf('.');
  const ext = dot > 0 && sanitized.length - dot <= 8 ? sanitized.slice(dot) : '';
  const base = dot > 0 && ext ? sanitized.slice(0, dot) : sanitized;
  const MAX_BASE = 14;
  if (base.length <= MAX_BASE) return sanitized;
  return `${base.slice(0, MAX_BASE).trimEnd()}…${ext}`;
}

export function uniqueTokenLabel(base: string, tokens: PromptToken[]): string {
  const taken = new Set(tokens.map((token) => token.label));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i += 1) {
    const candidate = `${base} (${i})`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Occurrences of registered tokens in the text, in document order. */
export function findTokenRanges(text: string, tokens: PromptToken[]): TokenRange[] {
  if (tokens.length === 0) return [];
  const byLabel = new Map(tokens.map((token) => [token.label, token]));
  const ranges: TokenRange[] = [];
  for (const match of text.matchAll(TOKEN_RE)) {
    const token = byLabel.get(match[1] ?? '');
    if (token) ranges.push({ token, start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

/**
 * Enforce token atomicity on a textarea selection: a collapsed caret inside a
 * token snaps to the boundary in the direction of travel (relative to the
 * previous caret); a range selection partially overlapping a token expands to
 * cover it whole.
 */
export function snapSelectionToTokens(
  selection: { start: number; end: number },
  ranges: TokenRange[],
  previousStart: number
): { start: number; end: number } {
  if (ranges.length === 0) return selection;
  if (selection.start === selection.end) {
    const pos = selection.start;
    for (const range of ranges) {
      if (pos > range.start && pos < range.end) {
        const snapped = pos >= previousStart ? range.end : range.start;
        return { start: snapped, end: snapped };
      }
    }
    return selection;
  }
  let { start, end } = selection;
  for (const range of ranges) {
    if (start > range.start && start < range.end) start = range.start;
    if (end > range.start && end < range.end) end = range.end;
  }
  return start === selection.start && end === selection.end ? selection : { start, end };
}

/** Marker the main process expands into a native clipboard paste. */
export function imageMarker(index: number): string {
  return `{{yoda-image:${index}}}`;
}

/**
 * Replace sentinels with their transport form. File tokens (and image tokens
 * when `imagesAsPaths` is set) become `@path` mentions; remaining image tokens
 * become `{{yoda-image:N}}` markers with `imagePaths[N]` carrying the path —
 * ordering follows the text. Unregistered `[...]` text is left untouched.
 */
export function serializePromptWithTokens(
  text: string,
  tokens: PromptToken[],
  options: { imagesAsPaths: boolean }
): { text: string; imagePaths: string[] } {
  if (tokens.length === 0) return { text, imagePaths: [] };
  const byLabel = new Map(tokens.map((token) => [token.label, token]));
  const imagePaths: string[] = [];
  const serialized = text.replace(TOKEN_RE, (match, label: string) => {
    const token = byLabel.get(label);
    if (!token) return match;
    if (token.kind === 'file' || options.imagesAsPaths) return `@${token.path}`;
    imagePaths.push(token.path);
    return imageMarker(imagePaths.length - 1);
  });
  return { text: serialized, imagePaths };
}

// Style properties that determine how textarea text flows; copied onto the
// measuring mirror so its glyph layout matches the textarea exactly.
const MIRROR_STYLE_PROPS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontVariant',
  'letterSpacing',
  'lineHeight',
  'textTransform',
  'wordSpacing',
  'textIndent',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'tabSize',
] as const;

/**
 * Measure where each token occurrence renders inside the textarea, via a
 * hidden mirror element replicating its text layout. Rects are relative to
 * the textarea border box with scrollTop NOT subtracted (caller adjusts).
 * A token wrapped across lines yields multiple rects.
 */
export function measureTokenRects(
  textarea: HTMLTextAreaElement,
  ranges: TokenRange[]
): Map<string, TokenRect[]> {
  const result = new Map<string, TokenRect[]>();
  if (ranges.length === 0) return result;

  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement('div');
  for (const prop of MIRROR_STYLE_PROPS) {
    mirror.style[prop as never] = style[prop as never];
  }
  mirror.style.position = 'absolute';
  mirror.style.top = '0';
  mirror.style.left = '-99999px';
  mirror.style.visibility = 'hidden';
  mirror.style.pointerEvents = 'none';
  mirror.style.boxSizing = 'border-box';
  mirror.style.border = '0';
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';

  const value = textarea.value;
  const spans = new Map<HTMLSpanElement, string>();
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      mirror.appendChild(document.createTextNode(value.slice(cursor, range.start)));
    }
    const span = document.createElement('span');
    span.textContent = value.slice(range.start, range.end);
    mirror.appendChild(span);
    spans.set(span, range.token.id);
    cursor = range.end;
  }
  mirror.appendChild(document.createTextNode(value.slice(cursor)));

  document.body.appendChild(mirror);
  try {
    const origin = mirror.getBoundingClientRect();
    for (const [span, tokenId] of spans) {
      const rects: TokenRect[] = [];
      for (const rect of span.getClientRects()) {
        rects.push({
          left: rect.left - origin.left,
          top: rect.top - origin.top,
          width: rect.width,
          height: rect.height,
        });
      }
      const existing = result.get(tokenId);
      if (existing) existing.push(...rects);
      else result.set(tokenId, rects);
    }
  } finally {
    mirror.remove();
  }
  return result;
}

/** Hit-test a point (textarea border-box coords, scroll already added to y). */
export function tokenAtPoint(
  rectsByToken: Map<string, TokenRect[]>,
  x: number,
  y: number
): string | null {
  for (const [tokenId, rects] of rectsByToken) {
    for (const rect of rects) {
      if (
        x >= rect.left &&
        x <= rect.left + rect.width &&
        y >= rect.top &&
        y <= rect.top + rect.height
      ) {
        return tokenId;
      }
    }
  }
  return null;
}
