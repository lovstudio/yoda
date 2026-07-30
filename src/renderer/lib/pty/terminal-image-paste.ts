import { pastedImagePathMention } from '@renderer/lib/image-path-mention';

/**
 * Apply the image-path setting at the terminal's real paste boundary.
 * Ordinary clipboard text must remain byte-for-byte unchanged.
 */
export function transformTerminalPasteText(text: string, imagesAsPaths: boolean): string {
  if (!imagesAsPaths) return text;
  return pastedImagePathMention(text) ?? text;
}
