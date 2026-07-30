const IMAGE_PATH_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

export function isImagePath(path: string): boolean {
  return IMAGE_PATH_RE.test(path);
}

/** Keep an image path textual so Agent clients do not promote it to an image input. */
export function imagePathMention(path: string): string {
  const normalized = path.startsWith('@') ? path.slice(1) : path;
  return `\`@${normalized}\``;
}

/**
 * Convert a single pasted image pathname into a backtick-wrapped mention.
 * Other clipboard text is left to the host input's native paste behavior.
 */
export function pastedImagePathMention(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes('\n')) return null;
  if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
    const code = trimmed.slice(1, -1);
    const path = code.startsWith('@') ? code.slice(1) : code;
    return isImagePath(path) ? imagePathMention(path) : null;
  }

  const withoutMention = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  const path =
    (withoutMention.startsWith('"') && withoutMention.endsWith('"')) ||
    (withoutMention.startsWith("'") && withoutMention.endsWith("'"))
      ? withoutMention.slice(1, -1)
      : withoutMention;
  return isImagePath(path) ? imagePathMention(path) : null;
}
